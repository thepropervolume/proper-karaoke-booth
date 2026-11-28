import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { chevronBackOutline, mailOutline } from 'ionicons/icons';
import { MobileHttpError } from './api';
import {
  accountError, accountLinkToken, createAccount, lookupAccount, redeemAccountLink, requestAccountLink,
  signIn, type SignedInAccount,
} from './account';
import './onboarding.css';

const boothMark = new URL('../../assets/branding/mobile/adaptive-foreground.png', import.meta.url).href;

type AuthStep = 'input' | 'existing' | 'new' | 'error';

export function Welcome({ onGuest, onSignIn }: { onGuest: () => void; onSignIn: () => void }) {
  return <main className="intro-shell intro-welcome" aria-labelledby="welcome-heading">
    <div className="intro-brand">
      <img src={boothMark} alt="" />
      <h1 id="welcome-heading">Karaoke Booth</h1>
      <p>Find a song. Take the mic.</p>
    </div>
    <div className="intro-actions">
      <IonButton shape="round" className="intro-primary" type="button" onClick={onGuest}>Continue as Guest</IonButton>
      <IonButton shape="round" className="intro-secondary" type="button" onClick={onSignIn}>Sign In / Create Account</IonButton>
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
  const [linkSent, setLinkSent] = useState<'confirm' | 'signin' | 'reset' | null>(null);
  const [pasteLink, setPasteLink] = useState(false);
  const [link, setLink] = useState(initialLink ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  const openedLink = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

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

  async function finishLink(token: string, password?: string) {
    try {
      const session = await redeemAccountLink(token, password);
      if (mounted.current) onSignedIn(session);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof MobileHttpError && (error.code === 'PASSWORD_REQUIRED' || error.code === 'VERIFY_PASSWORD_REQUIRED')) {
        setLink(token);
        setLinkPassword(error.code === 'PASSWORD_REQUIRED' ? 'reset' : 'verify');
        return;
      }
      throw error;
    }
  }

  useEffect(() => {
    const token = accountLinkToken(initialLink ?? '');
    if (!token || openedLink.current) return;
    openedLink.current = true;
    void complete(() => finishLink(token), 'That link is invalid or expired. Request a new link.');
  // Links are exchanged only once when this form opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLink]);

  function checkEmail() {
    const address = email.trim();
    void complete(async () => {
      try {
        const next = await lookupAccount(address);
        if (!mounted.current) return;
        if (next === 'setup-password') {
          await requestAccountLink(address, 'reset');
          if (mounted.current) showEmailSent('reset');
        } else setStep(next);
      } catch (error) {
        if (mounted.current) setStep('error');
        throw error;
      }
    }, 'Couldn’t check this email. Try again.');
  }

  function showEmailSent(kind: NonNullable<typeof linkSent>) {
    setLinkSent(kind);
    setLinkMode(true);
    setPasteLink(false);
    setLink('');
    setLinkPassword(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (linkMode) {
      const token = accountLinkToken(link);
      if (!token) { setMessage('Paste the complete sign-in link from your Booth email.'); return; }
      void complete(() => finishLink(token, linkPassword ? password : undefined), 'That link is invalid or expired. Request a new link.');
      return;
    }

    if (step === 'existing') {
      void complete(async () => {
        const session = await signIn(email.trim(), password);
        if (mounted.current) onSignedIn(session);
      }, 'Couldn’t sign in. Try again.');
    } else if (step === 'new') {
      const name = String(form.get('name') ?? '').trim();
      if (!name) { setMessage('Enter the name you sing under.'); return; }
      void complete(async () => {
        await createAccount(email.trim(), name, password);
        if (!mounted.current) return;
        showEmailSent('confirm');
      }, 'Couldn’t create your account. Try again.');
    } else checkEmail();
  }

  function sendLink(purpose: 'signin' | 'reset') {
    void complete(async () => {
      await requestAccountLink(email.trim(), purpose);
      if (!mounted.current) return;
      showEmailSent(purpose);
    }, 'Couldn’t send a link. Try again.');
  }

  const heading = linkMode ? linkPassword === 'reset' ? 'Set Your Password' : linkPassword === 'verify' ? 'Confirm Your Account' :
    linkSent ? 'Check Your Email' : initialLink ? 'Opening Sign-in Link' : 'Use an Email Link' : step === 'new' ? 'Create Account' : 'Sign In';
  return <main className="intro-shell intro-auth" aria-labelledby="auth-heading">
    <IonButton shape="round" className="intro-back" type="button" aria-label="Back" disabled={busy} onClick={() => {
      if (!linkMode) onBack();
      else {
        setLinkMode(false);
        setLinkSent(null);
        setLinkPassword(null);
        setPasteLink(false);
        setLink('');
        setMessage('');
      }
    }}><IonIcon icon={chevronBackOutline} aria-hidden="true" /></IonButton>
    <h1 id="auth-heading">{heading}</h1>
    <p>{linkMode ? linkPassword === 'reset' ? 'Choose a new password for your Booth account.' :
      linkPassword === 'verify' ? 'Enter the password you chose to finish creating your Booth account.' :
      linkSent ? `I sent a ${linkSent === 'confirm' ? 'confirmation' : linkSent === 'reset' ? 'password setup' : 'sign-in'} link to ${email.trim()}. Open that email and tap the link to continue.` :
      initialLink ? 'Checking the link from your Booth email.' : 'Paste the complete link from your Booth email.' :
      step === 'new' ? 'Choose the name you sing under and a password.' :
      step === 'existing' ? 'Welcome back. Enter your password to continue.' : 'Use the email address for your Booth account.'}</p>
    <form className="intro-form" onSubmit={submit} aria-busy={busy}>
      {linkMode ? <>
        {pasteLink && !linkPassword && <label>Link from your Booth email<input type="url" name="link" value={link} required maxLength={512} spellCheck={false}
          autoCapitalize="none" autoComplete="off" onChange={event => setLink(event.target.value)} /></label>}
        {linkPassword && <label>{linkPassword === 'reset' ? 'New password' : 'Your Booth password'}<input type="password" name="password" required minLength={12} maxLength={128} autoComplete={linkPassword === 'reset' ? 'new-password' : 'current-password'} /></label>}
        {(linkPassword || pasteLink) && <IonButton shape="round" className="intro-primary" type="submit" disabled={busy}>{linkPassword === 'reset' ? 'Set New Password' : 'Continue'}</IonButton>}
      </> : <>
        <label>Email address<input name="email" value={email} type="email" inputMode="email"
          autoComplete="email" autoCapitalize="none" placeholder="you@example.com" maxLength={254} required disabled={busy}
          onChange={event => { setEmail(event.target.value); setStep('input'); setMessage(''); }} /></label>
        {(step === 'input' || step === 'error') && <IonButton shape="round" className="intro-primary" type="submit" disabled={busy}>{step === 'error' ? 'Try Again' : 'Continue'}</IonButton>}
        {(step === 'new' || step === 'existing') && <>
          {step === 'new' && <label>Singer name<input name="name" maxLength={60} autoComplete="nickname" required /></label>}
          <label>{step === 'new' ? 'Create a password' : 'Password'}<input key={step} name="password" type="password" required
            minLength={step === 'new' ? 12 : undefined} maxLength={128}
            placeholder={step === 'new' ? 'At least 12 characters' : undefined}
            autoComplete={step === 'new' ? 'new-password' : 'current-password'} /></label>
          <IonButton shape="round" className="intro-primary" type="submit" disabled={busy}>{step === 'new' ? 'Create Account' : 'Sign In'}</IonButton>
        </>}
      </>}
    </form>
    <div className="intro-actions">
      {!linkMode && step === 'existing' && <>
        <IonButton fill="clear" shape="round" className="intro-link" type="button" disabled={busy} onClick={() => sendLink('reset')}>Forgot password?</IonButton>
        <IonButton shape="round" className="intro-secondary" type="button" disabled={busy} onClick={() => sendLink('signin')}>
          <IonIcon icon={mailOutline} aria-hidden="true" /> Email me a sign-in link
        </IonButton>
      </>}
      {!linkMode && <IonButton fill="clear" shape="round" className="intro-link" type="button" disabled={busy}
        onClick={() => { setMessage(''); setLinkMode(true); setPasteLink(true); }}>I Already Have a Booth Email</IonButton>}
      {linkSent && !pasteLink && <IonButton fill="clear" shape="round" className="intro-link" type="button" disabled={busy}
        onClick={() => setPasteLink(true)}>Paste the Link Instead</IonButton>}
      <IonButton fill="clear" shape="round" className="intro-link" type="button" disabled={busy} onClick={onGuest}>Continue as Guest</IonButton>
    </div>
    {message && <p className="intro-status" role="status">{message}</p>}
  </main>;
}
