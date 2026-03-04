import { h } from 'preact';

interface SectionToggleProps {
    title: string;
    switchLabel: string;
    showConsentButton: boolean;
    onConsentScopes: () => void;
    onSwitch: () => void;
}

export function SectionToggle({
    title,
    switchLabel,
    showConsentButton,
    onConsentScopes,
    onSwitch,
}: SectionToggleProps) {
    return (
        <div class="section-toggle">
            <h2>{title}</h2>
            <div class="section-header-actions">
                {showConsentButton && (
                    <button class="btn-secondary" onClick={onConsentScopes}>
                        Consent additional scopes
                    </button>
                )}
                <button class="btn-secondary" onClick={onSwitch}>
                    {switchLabel}
                </button>
            </div>
        </div>
    );
}
