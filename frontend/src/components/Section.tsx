import { h } from 'preact';

export interface SectionProps {
    /** Whether the section is hidden */
    hidden: boolean;
    /** Element IDs for child mount-point divs (used by other render calls) */
    rootIds: {
        createSubscription: string;
        result: string;
        subscriptions: string;
        notifications: string;
    };
}

/**
 * A togglable section that provides mount-point divs for the create-subscription
 * form, result box, subscriptions table, and notifications table.
 *
 * Each mount-point div is identified by a stable ID so that external `render()`
 * calls can target them independently.
 */
export function Section({ hidden, rootIds }: SectionProps) {
    return (
        <div hidden={hidden}>
            <div id={rootIds.createSubscription} />
            <div id={rootIds.result} />
            <div id={rootIds.subscriptions} />
            <div id={rootIds.notifications} />
        </div>
    );
}
