import { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ResultMessage } from './ResultBox';

const CHANGE_TYPES = ['created', 'updated', 'deleted'] as const;

/**
 * If the resource path contains a query string (`?`), URL-encode each
 * parameter value so that raw spaces and other special characters are
 * transmitted correctly.  Keys (e.g. `$filter`) are left as-is.
 *
 * Already-encoded sequences (e.g. `%20`) are decoded first to avoid
 * double-encoding.
 */
function encodeResourceQueryParams(resource: string): string {
    const qIndex = resource.indexOf('?');
    if (qIndex === -1) return resource;

    const basePath = resource.substring(0, qIndex);
    const queryString = resource.substring(qIndex + 1);

    const encodedPairs = queryString.split('&').map((pair) => {
        const eqIndex = pair.indexOf('=');
        if (eqIndex === -1) return pair;
        const key = pair.substring(0, eqIndex);
        const rawValue = pair.substring(eqIndex + 1);
        try {
            return `${key}=${encodeURIComponent(decodeURIComponent(rawValue))}`;
        } catch {
            return `${key}=${encodeURIComponent(rawValue)}`;
        }
    });

    return `${basePath}?${encodedPairs.join('&')}`;
}

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
    /** Called when a result (success or error) should be displayed */
    onResult?: (result: ResultMessage) => void;
}

export function CreateSubscriptionForm({
    resourcePlaceholder = 'e.g. me/messages',
    extraContent,
    disabled: externalDisabled = false,
    onSubmit,
    onResult,
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
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const toggleDropdown = useCallback(() => {
        setDropdownOpen((prev) => !prev);
    }, []);

    // Attach/detach the outside-click listener whenever the dropdown opens/closes
    useEffect(() => {
        if (!dropdownOpen) return;

        const handleDocClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };

        document.addEventListener('click', handleDocClick, true);
        return () => document.removeEventListener('click', handleDocClick, true);
    }, [dropdownOpen]);

    const toggleChangeType = useCallback((type: string) => {
        setSelectedChangeTypes((prev) => ({ ...prev, [type]: !prev[type] }));
    }, []);

    const changeTypeLabel =
        CHANGE_TYPES.filter((t) => selectedChangeTypes[t]).join(', ') || 'Select change types';

    const showResult = useCallback(
        (msg: ResultMessage) => {
            onResult?.(msg);
        },
        [onResult],
    );

    const resetForm = useCallback(() => {
        setResource('');
        setSelectedChangeTypes({ created: true, updated: true, deleted: true });
        setExpiration(60);
        setIncludeResourceData(false);
    }, []);

    const handleSubmit = useCallback(
        async (e: Event) => {
            e.preventDefault();

            if (resource.trim().length === 0) {
                showResult({ text: 'Please enter a resource path.', success: false });
                return;
            }

            const changeType = CHANGE_TYPES.filter((t) => selectedChangeTypes[t]).join(',');
            if (!changeType) {
                showResult({ text: 'Please select at least one change type.', success: false });
                return;
            }

            setBusy(true);
            try {
                const encodedResource = encodeResourceQueryParams(resource.trim());
                const result = await onSubmit(
                    encodedResource,
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
                        <label class="label-full-width">
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
