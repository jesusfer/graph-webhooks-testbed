// -- App Result Box --
// Renders a shared ResultBox between the create-subscription form and the subscriptions table.

import { h, render } from 'preact';
import { ResultBox, ResultMessage } from '../../components/ResultBox';

let currentResult: ResultMessage | null = null;

function renderComponent(): void {
    const container = document.getElementById('app-result-root');
    if (!container) return;

    render(
        h(ResultBox, {
            result: currentResult,
            onDismiss: () => {
                currentResult = null;
                renderComponent();
            },
        }),
        container,
    );
}

/**
 * Show a result message in the app section's result box.
 */
export function showAppResult(result: ResultMessage): void {
    currentResult = result;
    renderComponent();
}
