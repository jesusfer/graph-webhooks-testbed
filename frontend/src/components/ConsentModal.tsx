import { useCallback, useState } from 'preact/hooks';
import { Modal } from './Modal';

export interface ConsentModalProps {
    /** Whether the modal is visible */
    open: boolean;
    /** Called when the modal should close */
    onClose: () => void;
    /** Returns the full list of currently-consented scopes for display */
    getCurrentScopes: () => string[];
    /** Called with the new scopes to consent. Should throw on failure. */
    onConsent: (newScopes: string[]) => Promise<void>;
}

/**
 * Modal for consenting to additional OAuth scopes.
 * Users enter comma-separated scopes and submit to trigger MSAL consent.
 */
export function ConsentModal({ open, onClose, getCurrentScopes, onConsent }: ConsentModalProps) {
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleClose = useCallback(() => {
        setInput('');
        setError(null);
        onClose();
    }, [onClose]);

    const handleConsent = useCallback(async () => {
        const raw = input.trim();
        if (!raw) {
            handleClose();
            return;
        }

        const newScopes = raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

        try {
            await onConsent(newScopes);
            setInput('');
            setError(null);
            onClose();
        } catch (err: any) {
            const errorMessage = err?.errorMessage || err?.message || String(err);
            setError(`Consent failed: ${errorMessage}`);
        }
    }, [input, onConsent, onClose, handleClose]);

    const currentScopes = open ? getCurrentScopes() : [];

    return (
        <Modal
            open={open}
            onClose={handleClose}
            title="Consent to additional scopes"
            actions={
                <>
                    <button class="btn-secondary" onClick={handleClose}>
                        Cancel
                    </button>
                    <button class="btn-primary" onClick={handleConsent}>
                        Consent
                    </button>
                </>
            }
        >
            <p>
                Enter additional OAuth scopes separated by commas. These will be stored in your
                browser and included in future authentication requests.
            </p>
            <input
                type="text"
                value={input}
                onInput={(e) => setInput((e.target as HTMLInputElement).value)}
                placeholder="e.g. Calendars.Read, Files.Read"
            />
            <div id="current-scopes">
                <strong>Current scopes:</strong> {currentScopes.join(', ')}
            </div>
            <p>This list of scopes may be incomplete.</p>
            {error && <div class="modal-error">{error}</div>}
        </Modal>
    );
}
