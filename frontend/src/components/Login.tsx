import { h } from 'preact';

interface LoginProps {
    onSignIn: () => void;
}

export function Login({ onSignIn }: LoginProps) {
    return (
        <div class="login-section">
            <div class="card">
            <h2>Welcome to Graph Webhooks Testbed</h2>
            <p>
                Sign in with your Microsoft account to manage Graph subscriptions and view webhook
                notifications.
            </p>
            <button class="btn-primary btn-login-main" onClick={onSignIn}>
                Sign in with Microsoft Entra
            </button>
            </div>
        </div>
    );
}
