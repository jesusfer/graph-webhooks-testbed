// -- Delegated Result Box --
// Renders a shared ResultBox between the create-subscription form and the subscriptions table.

import { h, render } from 'preact';
import { ResultBox, ResultMessage } from '../components/ResultBox';

let currentResult: ResultMessage | null = null;

function renderComponent(): void {
    const container = document.getElementById('delegated-result-root');
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
 * Show a result message in the delegated section's result box.
 */
export function showDelegatedResult(result: ResultMessage): void {
    currentResult = result;
    renderComponent();
}

/**
 * Clear the delegated section's result box.
 */
export function clearDelegatedResult(): void {
    currentResult = null;
    renderComponent();
}
