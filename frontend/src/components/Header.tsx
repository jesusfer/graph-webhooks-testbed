import { h } from 'preact';

interface HeaderProps {
    userName: string | null;
    avatarUrl: string | null;
    isSignedIn: boolean;
    onSignIn: () => void;
    onSignOut: () => void;
}

export function Header({ userName, avatarUrl, isSignedIn, onSignIn, onSignOut }: HeaderProps) {
    return (
        <header>
            <h1>
                <img
                    src="/images/graph.png"
                    alt="Graph"
                    class="header-logo"
                />{' '}
                Graph Webhooks Testbed
            </h1>
            <div id="user-info">
                {avatarUrl && <img alt="" class="user-avatar" src={avatarUrl} />}
                {userName && <span id="user-name">{userName}</span>}
                {!isSignedIn && (
                    <button class="btn-secondary btn-header" onClick={onSignIn}>
                        Sign In
                    </button>
                )}
                {isSignedIn && (
                    <button class="btn-secondary btn-header" onClick={onSignOut}>
                        Sign Out
                    </button>
                )}
            </div>
        </header>
    );
}
