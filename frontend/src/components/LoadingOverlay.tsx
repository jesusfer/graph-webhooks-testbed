import { h } from 'preact';

interface LoadingOverlayProps {
    visible: boolean;
}

export function LoadingOverlay({ visible }: LoadingOverlayProps) {
    if (!visible) return null;

    return (
        <div class="app-loading">
            <div class="app-loading-content">
                <span class="spinner app-loading-spinner" />
                <span>Loading…</span>
            </div>
        </div>
    );
}
