import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IonIcon } from '@ionic/react';
import { chevronBackOutline, mailOutline } from 'ionicons/icons';
import { MobileHttpError } from './api';
import {
  accountError, accountLinkToken, createAccount, lookupAccount, redeemAccountLink, requestAccountLink,
  signIn, type SignedInAccount,
} from './account';
import './onboarding.css';

const boothMark = new URL('../../assets/branding/mobile/adaptive-foreground.png', import.meta.url).href;

type AuthStep = 'input' | 'lookup' | 'existing' | 'new' | 'error';

export function Welcome({ onGuest, onSignIn }: { onGuest: () => void; onSignIn: () => void }) {
  return <main className="intro-shell intro-welcome" aria-labelledby="welcome-heading">
    <div className="intro-brand">
      <img src={boothMark} alt="" />
      <h1 id="welcome-heading">Karaoke Booth</h1>
      <p>Find a song. Take the mic.</p>
    </div>
    <div className="intro-actions">
      <button className="intro-primary" type="button" onClick={onGuest}>Continue as Guest</button>
      <button className="intro-secondary" type="button" onClick={onSignIn}>Sign In / Create Account</button>
    </div>
  </main>;
}

export function AccountAccess({ onBack, onGuest, onSignedIn, initialLink }: {
  onBack: () => void;
  onGuest: () => void;
  onSignedIn: (session: SignedInAccount) => void;
  initialLink?: string;
}) {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<AuthStep>('input');
  const [linkMode, setLinkMode] = useState(!!initialLink);
  const [linkPassword, setLinkPassword] = useState<'verify' | 'reset' | null>(null);
  const [link, setLink] = useState(initialLink ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const emailField = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const compact = email.trim();
    if (linkMode || !emailField.current?.validity.valid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(compact)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStep('lookup');
      void lookupAccount(compact, controller.signal).then(existing => {
        if (!controller.signal.aborted) setStep(existing ? 'existing' : 'new');
      }).catch(error => {
        if (controller.signal.aborted) return;
        setStep('error');
        setMessage(accountError(error, 'Couldn’t check this email. Try again.'));
      });
    }, 420);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [email, linkMode, retry]);

  async function complete(action: () => Promise<void>, failure: string) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage('');
    try { await action(); }
    catch (error) { if (mounted.current) setMessage(accountError(error, failure)); }
    finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (linkMode) {
      const token = accountLinkToken(link);
      if (!token) { setMessage('Paste the complete sign-in link from your Booth email.'); return; }
      void complete(async () => {
        try {
          const session = await redeemAccountLink(token, linkPassword ? password : undefined);
          if (mounted.current) onSignedIn(session);
        } catch (error) {
          if (error instanceof MobileHttpError && (error.code === 'PASSWORD_REQUIRED' || error.code === 'VERIFY_PASSWORD_REQUIRED')) {
            setLinkPassword(error.code === 'PASSWORD_REQUIRED' ? 'reset' : 'verify');
            return;
          }
          throw error;
        }
      }, 'That link is invalid or expired. Request a new link.');
      return;
    }

    if (step === 'existing') {
      void complete(async () => {
        const session = await signIn(email.trim(), password);
        if (mounted.current) onSignedIn(session);
      }, 'Couldn’t sign in. Try again.');
    } else if (step === 'new') {
      const name = String(form.get('name') ?? '').trim();
      if (!name) { setMessage('Enter a display name.'); return; }
      void complete(async () => {
        await createAccount(email.trim(), name, password);
        if (!mounted.current) return;
        setLinkMode(true);
        setMessage('Check your email for a confirmation link. You can open it in your browser or paste it here.');
      }, 'Couldn’t create your account. Try again.');
    }
  }

  function sendLink(purpose: 'signin' | 'reset') {
    void complete(async () => {
      await requestAccountLink(email.trim(), purpose);
      if (!mounted.current) return;
      setLinkPassword(purpose === 'reset' ? 'reset' : null);
      setLinkMode(true);
      setMessage(purpose === 'reset'
        ? 'Check your email for a password reset link. You can open it in your browser or paste it here.'
        : 'Check your email for a sign-in link. You can open it in your browser or paste it here.');
    }, 'Couldn’t send a link. Try again.');
  }

  const heading = linkMode ? linkPassword === 'reset' ? 'Reset Password' : linkPassword === 'verify' ? 'Confirm Your Account' : 'Use an Email Link' : step === 'new' ? 'Create Account' : 'Sign In';
  return <main className="intro-shell intro-auth" aria-labelledby="auth-heading">
    <button className="intro-back" type="button" aria-label="Back" disabled={busy} onClick={() => {
      if (!linkMode) onBack();
      else {
        setLinkMode(false);
        setLinkPassword(null);
        setLink('');
        setMessage('');
      }
    }}><IonIcon icon={chevronBackOutline} aria-hidden="true" /></button>
    <h1 id="auth-heading">{heading}</h1>
    <p>{linkMode ? 'Paste the link from your Booth email.' : step === 'new' ? 'Choose a display name and password.' :
      step === 'existing' ? 'Welcome back. Enter your password to continue.' : 'Use the email address for your Booth account.'}</p>
    <form className="intro-form" onSubmit={submit} aria-busy={busy || step === 'lookup'}>
      {linkMode ? <>
        <label>Email link<input type="text" name="link" value={link} required maxLength={512} spellCheck={false}
          autoCapitalize="none" autoComplete="off" onChange={event => setLink(event.target.value)} /></label>
        {linkPassword && <label>{linkPassword === 'reset' ? 'New password' : 'Your Booth password'}<input type="password" name="password" required minLength={12} maxLength={128} autoComplete={linkPassword === 'reset' ? 'new-password' : 'current-password'} /></label>}
        <button className="intro-primary" type="submit" disabled={busy}>{linkPassword === 'reset' ? 'Set New Password' : 'Continue'}</button>
      </> : <>
        <label>Email address<input ref={emailField} name="email" value={email} type="email" inputMode="email"
          autoComplete="email" autoCapitalize="none" placeholder="you@example.com" maxLength={254} required disabled={busy}
          onChange={event => { setEmail(event.target.value); setStep('input'); setMessage(''); }} /></label>
        {step === 'lookup' && <p role="status">Checking email…</p>}
        {step === 'error' && <button className="intro-secondary" type="button" onClick={() => { setMessage(''); setRetry(value => value + 1); }}>Try Again</button>}
        {(step === 'new' || step === 'existing') && <>
          {step === 'new' && <label>Display name<input name="name" maxLength={60} autoComplete="nickname" required /></label>}
          <label>{step === 'new' ? 'Create a password' : 'Password'}<input key={step} name="password" type="password" required
            minLength={step === 'new' ? 12 : undefined} maxLength={128}
            placeholder={step === 'new' ? 'At least 12 characters' : undefined}
            autoComplete={step === 'new' ? 'new-password' : 'current-password'} /></label>
          <button className="intro-primary" type="submit" disabled={busy}>{step === 'new' ? 'Create Account' : 'Sign In'}</button>
        </>}
      </>}
    </form>
    <div className="intro-actions">
      {!linkMode && step === 'existing' && <>
        <button className="intro-link" type="button" disabled={busy} onClick={() => sendLink('reset')}>Forgot password?</button>
        <button className="intro-secondary" type="button" disabled={busy} onClick={() => sendLink('signin')}>
          <IonIcon icon={mailOutline} aria-hidden="true" /> Email me a sign-in link
        </button>
      </>}
      {!linkMode && <button className="intro-link" type="button" disabled={busy} onClick={() => { setMessage(''); setLinkMode(true); }}>Use a link I already have</button>}
      <button className="intro-link" type="button" disabled={busy} onClick={onGuest}>Continue as Guest</button>
    </div>
    {message && <p className="intro-status" role="status">{message}</p>}
  </main>;
}
