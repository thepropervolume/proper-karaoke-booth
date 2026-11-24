import { useEffect, useState } from 'react';
import { SingerWorkspace } from './SingerWorkspace';
import { AccountAccess, Welcome } from './MobileOnboarding';
import { MobileHttpError } from './api';
import {
  accountLinkToken, knownSessionToken, readAccount, rememberSessionToken, signOut,
  type SignedInAccount,
} from './account';

const enteredKey = 'tpv-mobile-welcome-complete';

function welcomeComplete(): boolean {
  try { return localStorage.getItem(enteredKey) === 'yes'; }
  catch { return false; }
}

/** Read a mail link once and remove its credential from the browser address bar. */
function takeAccountLink(): string | undefined {
  if (!location.hash.startsWith('#accountLink=')) return;
  const token = accountLinkToken(location.href);
  history.replaceState(null, '', location.pathname + location.search);
  return token ?? undefined;
}

export function MobileApp() {
  const [link, setLink] = useState(takeAccountLink);
  const [entered, setEntered] = useState(welcomeComplete);
  const [showAccount, setShowAccount] = useState(!!link);
  const [linkUsed, setLinkUsed] = useState(false);
  const [session, setSession] = useState<SignedInAccount | null>(null);

  useEffect(() => {
    const token = knownSessionToken();
    if (!token) return;
    const controller = new AbortController();
    void readAccount(token, controller.signal).then(account => {
      if (!controller.signal.aborted && knownSessionToken() === token) setSession({ token, account });
    }).catch(error => {
      if (!controller.signal.aborted && knownSessionToken() === token && error instanceof MobileHttpError && error.status === 401) {
        rememberSessionToken(null);
      }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const handleLink = () => {
      const next = takeAccountLink();
      if (!next) return;
      setLink(next);
      setLinkUsed(false);
      setShowAccount(true);
    };
    window.addEventListener('hashchange', handleLink);
    return () => window.removeEventListener('hashchange', handleLink);
  }, []);

  function exitAccount() {
    setShowAccount(false);
    setLinkUsed(true);
  }

  function enter() {
    try { localStorage.setItem(enteredKey, 'yes'); } catch { /* Guest access does not require storage. */ }
    setEntered(true);
    exitAccount();
  }

  function signedIn(next: SignedInAccount) {
    rememberSessionToken(next.token);
    setSession(next);
    enter();
  }

  function handleSignOut() {
    const token = session?.token ?? knownSessionToken();
    rememberSessionToken(null);
    setSession(null);
    if (token) void signOut(token).catch(() => {});
  }

  return <>
    {entered && <div className="intro-hidden" hidden={showAccount} inert={showAccount}>
      <SingerWorkspace account={session?.account ?? null} onSignIn={() => setShowAccount(true)} onSignOut={handleSignOut} />
    </div>}
    {showAccount
      ? <AccountAccess key={linkUsed ? undefined : link} initialLink={linkUsed ? undefined : link} onBack={exitAccount} onGuest={enter} onSignedIn={signedIn} />
      : !entered && <Welcome onGuest={enter} onSignIn={() => setShowAccount(true)} />}
  </>;
}
