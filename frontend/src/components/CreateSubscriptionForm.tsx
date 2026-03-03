import { ComponentChildren } from 'preact';
import { useCallback, useRef, useState, useEffect } from 'preact/hooks';

const CHANGE_TYPES = ['created', 'updated', 'deleted'] as const;

export interface SubmitResult {
    success: boolean;
    message: string;
}

export interface CreateSubscriptionFormProps {
    /** Placeholder text for the resource input */
    resourcePlaceholder?: string;
    /** Extra content rendered between the resource input and the change-type row */
    extraContent?: ComponentChildren;
    /** When true the entire form is disabled (e.g. during a renewal). */
    disabled?: boolean;
    /**
     * Called when the form is submitted.
     * Return a result object to display feedback in the form.
     */
    onSubmit: (
        resource: string,
        changeType: string,
        expirationMinutes: number,
        includeResourceData: boolean,
    ) => Promise<SubmitResult>;
}

interface ResultMessage {
    text: string;
    success: boolean;
    /** If the error contains a JSON body, the pre-formatted markup */
    richHtml?: { prefix: string; json: string };
}

export function CreateSubscriptionForm({
    resourcePlaceholder = 'e.g. me/messages',
    extraContent,
    disabled: externalDisabled = false,
    onSubmit,
}: CreateSubscriptionFormProps) {
    const [resource, setResource] = useState('');
    const [selectedChangeTypes, setSelectedChangeTypes] = useState<Record<string, boolean>>({
        created: true,
        updated: true,
        deleted: true,
    });
    const [expiration, setExpiration] = useState(60);
    const [includeResourceData, setIncludeResourceData] = useState(false);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<ResultMessage | null>(null);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Close dropdown when clicking outside
    const handleDocClick = useCallback((e: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
            setDropdownOpen(false);
        }
    }, []);

    // Attach/detach the outside-click listener with the dropdown
    const registerDocListener = useCallback(
        (open: boolean) => {
            if (open) {
                document.addEventListener('click', handleDocClick, true);
            } else {
                document.removeEventListener('click', handleDocClick, true);
            }
        },
        [handleDocClick],
    );

    const toggleDropdown = useCallback(() => {
        setDropdownOpen((prev) => {
            const next = !prev;
            registerDocListener(next);
            return next;
        });
    }, [registerDocListener]);

    useEffect(() => {
        return () => {
            document.removeEventListener('click', handleDocClick, true);
        };
    }, [handleDocClick]);

    const toggleChangeType = useCallback((type: string) => {
        setSelectedChangeTypes((prev) => ({ ...prev, [type]: !prev[type] }));
    }, []);

    const changeTypeLabel =
        CHANGE_TYPES.filter((t) => selectedChangeTypes[t]).join(', ') || 'Select change types';

    const showResult = useCallback((msg: ResultMessage) => {
        if (autoHideTimer.current) {
            clearTimeout(autoHideTimer.current);
            autoHideTimer.current = null;
        }
        setResult(msg);
        if (msg.success) {
            autoHideTimer.current = setTimeout(() => {
                setResult(null);
                autoHideTimer.current = null;
            }, 60_000);
        }
    }, []);

    const resetForm = useCallback(() => {
        setResource('');
        setSelectedChangeTypes({ created: true, updated: true, deleted: true });
        setExpiration(60);
        setIncludeResourceData(false);
    }, []);

    const handleSubmit = useCallback(
        async (e: Event) => {
            e.preventDefault();

            const changeType = CHANGE_TYPES.filter((t) => selectedChangeTypes[t]).join(',');
            if (!changeType) {
                showResult({ text: 'Please select at least one change type.', success: false });
                return;
            }

            setResult(null);
            setBusy(true);
            try {
                const result = await onSubmit(
                    resource.trim(),
                    changeType,
                    expiration,
                    includeResourceData,
                );
                showResult(formatResultMessage(result.message, result.success));
                if (result.success) {
                    resetForm();
                }
            } catch (err) {
                showResult(
                    formatResultMessage(
                        `Failed to create subscription: ${err instanceof Error ? err.message : String(err)}`,
                        false,
                    ),
                );
            } finally {
                setBusy(false);
            }
        },
        [
            resource,
            selectedChangeTypes,
            expiration,
            includeResourceData,
            onSubmit,
            showResult,
            resetForm,
        ],
    );

    return (
        <div class="card">
            <div class="section-header">
                <h2>Create Subscription</h2>
            </div>
            <form onSubmit={handleSubmit}>
                <fieldset disabled={busy || externalDisabled}>
                    <div class="form-row">
                        <label style="min-width: 100%">
                            Resource
                            <input
                                type="text"
                                placeholder={resourcePlaceholder}
                                required
                                value={resource}
                                onInput={(e) => setResource((e.target as HTMLInputElement).value)}
                            />
                        </label>
                    </div>

                    {extraContent && <div class="form-row">{extraContent}</div>}

                    <div class="form-row">
                        <label>
                            Change Type
                            <div class="changetype-dropdown" ref={dropdownRef}>
                                <button
                                    type="button"
                                    class="changetype-toggle"
                                    onClick={toggleDropdown}
                                >
                                    {changeTypeLabel}
                                </button>
                                <div class="changetype-menu" hidden={!dropdownOpen}>
                                    {CHANGE_TYPES.map((ct) => (
                                        <label class="changetype-option" key={ct}>
                                            <input
                                                type="checkbox"
                                                checked={!!selectedChangeTypes[ct]}
                                                onChange={() => toggleChangeType(ct)}
                                            />{' '}
                                            {ct}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </label>
                        <label>
                            Expiration (minutes from now)
                            <input
                                type="number"
                                value={expiration}
                                min={1}
                                max={4230}
                                onInput={(e) =>
                                    setExpiration(
                                        parseInt((e.target as HTMLInputElement).value, 10) || 60,
                                    )
                                }
                            />
                        </label>
                        <label class="checkbox-label">
                            <input
                                type="checkbox"
                                checked={includeResourceData}
                                onChange={(e) =>
                                    setIncludeResourceData((e.target as HTMLInputElement).checked)
                                }
                            />
                            Include resource data
                        </label>
                    </div>
                    <button type="submit" class="btn-primary">
                        <span class="spinner" hidden={!busy} />
                        <span>{busy ? 'Creating...' : 'Create Subscription'}</span>
                    </button>
                </fieldset>
            </form>

            {result && (
                <div class={`create-result ${result.success ? 'success' : 'error'}`}>
                    {result.richHtml ? (
                        <>
                            {result.richHtml.prefix && result.richHtml.prefix + '\n'}
                            <pre
                                style={{
                                    margin: '6px 0 0',
                                    whiteSpace: 'pre-wrap',
                                    fontSize: '0.82rem',
                                }}
                            >
                                {result.richHtml.json}
                            </pre>
                        </>
                    ) : (
                        result.text
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Parse an error message and, if it contains a JSON body, split it into a
 * human-readable prefix and pretty-printed JSON.
 */
export function formatResultMessage(message: string, success: boolean): ResultMessage {
    if (!success) {
        const jsonMatch = message.match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[1]);
                const prefix = message.substring(0, jsonMatch.index).trimEnd();
                return {
                    text: message,
                    success,
                    richHtml: { prefix, json: JSON.stringify(parsed, null, 2) },
                };
            } catch {
                // Not valid JSON — fall through
            }
        }
    }
    return { text: message, success };
}
