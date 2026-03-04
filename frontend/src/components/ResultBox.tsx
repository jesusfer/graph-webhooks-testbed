import { useEffect, useRef } from 'preact/hooks';

export interface ResultMessage {
    text: string;
    success: boolean;
    /** If the error contains a JSON body, the pre-formatted markup */
    richHtml?: { prefix: string; json: string };
}

export interface ResultBoxProps {
    /** Current result to display (null = hidden) */
    result: ResultMessage | null;
    /** Called when the user dismisses the result */
    onDismiss: () => void;
}

/**
 * A standalone result box that shows operation outcomes (create, renew, delete).
 * Green for success, red for error. Includes a dismiss button.
 * Auto-hides successful results after 60 seconds.
 */
export function ResultBox({ result, onDismiss }: ResultBoxProps) {
    const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (autoHideTimer.current) {
            clearTimeout(autoHideTimer.current);
            autoHideTimer.current = null;
        }
        if (result?.success) {
            autoHideTimer.current = setTimeout(() => {
                onDismiss();
                autoHideTimer.current = null;
            }, 60_000);
        }
        return () => {
            if (autoHideTimer.current) {
                clearTimeout(autoHideTimer.current);
            }
        };
    }, [result, onDismiss]);

    if (!result) return null;

    return (
        <div class={`create-result ${result.success ? 'success' : 'error'}`}>
            <div class="create-result-inner">
                <div class="create-result-body">
                    {result.richHtml ? (
                        <>
                            {result.richHtml.prefix && result.richHtml.prefix + '\n'}
                            <pre>{result.richHtml.json}</pre>
                        </>
                    ) : (
                        result.text
                    )}
                </div>
                <button
                    type="button"
                    class="create-result-dismiss"
                    onClick={onDismiss}
                    title="Dismiss"
                >
                    ✕
                </button>
            </div>
        </div>
    );
}
