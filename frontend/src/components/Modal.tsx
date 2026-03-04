import { ComponentChildren } from 'preact';
import { useCallback } from 'preact/hooks';

export interface ModalProps {
    /** Whether the modal is visible */
    open: boolean;
    /** Called when the user requests to close (backdrop click or cancel) */
    onClose: () => void;
    /** Modal title */
    title: string;
    /** Modal body content */
    children: ComponentChildren;
    /** Footer actions (buttons). If omitted only backdrop-click closes. */
    actions?: ComponentChildren;
}

/**
 * Generic reusable modal overlay.
 * Renders a centered dialog with a title, body content, and optional action buttons.
 */
export function Modal({ open, onClose, title, children, actions }: ModalProps) {
    const handleOverlayClick = useCallback(
        (e: Event) => {
            if (e.target === e.currentTarget) onClose();
        },
        [onClose],
    );

    if (!open) return null;

    return (
        <div class="modal-overlay" onClick={handleOverlayClick}>
            <div class="modal">
                <h3>{title}</h3>
                {children}
                {actions && <div class="modal-actions">{actions}</div>}
            </div>
        </div>
    );
}
