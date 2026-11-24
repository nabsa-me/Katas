'use client';

import { decodeJwt } from 'jose';
import { calculatePKCECodeChallenge, randomPKCECodeVerifier, randomState } from 'openid-client';
import { useEffect, useState, useSyncExternalStore } from 'react';

interface LocalStorageLoginProps {
  issuer: string;
  clientId: string;
  redirectUri: string;
}

const TOKENS_CHANGED = 'problem-tokens-changed';

function subscribe(onChange: () => void) {
  window.addEventListener(TOKENS_CHANGED, onChange);
  return () => window.removeEventListener(TOKENS_CHANGED, onChange);
}

/**
 * BUG 1: the tokens live in localStorage. Any script that runs on this origin (an XSS, a compromised
 * dependency, a browser extension) can read them and replay them from anywhere until they expire.
 */
function saveTokens(tokens: { access_token: string; id_token: string } | null) {
  if (tokens) {
    localStorage.setItem('access_token', tokens.access_token);
    localStorage.setItem('id_token', tokens.id_token);
  } else {
    localStorage.removeItem('access_token');
    localStorage.removeItem('id_token');
  }
  window.dispatchEvent(new Event(TOKENS_CHANGED));
}

/** A single-page-app login: the whole Authorization Code + PKCE flow runs in the browser. */
export function LocalStorageLogin({ issuer, clientId, redirectUri }: LocalStorageLoginProps) {
  const idToken = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem('id_token'),
    () => null,
  );
  const [report, setReport] = useState<string | null>(null);

  // Back from the provider with `?code=…`: exchange the code from the browser and keep the tokens.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const pending = sessionStorage.getItem('pkce');
    if (!code || !pending) return;
    sessionStorage.removeItem('pkce');
    window.history.replaceState(null, '', redirectUri);
    const { verifier, state } = JSON.parse(pending) as { verifier: string; state: string };
    if (params.get('state') !== state) return;
    const body = { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId };
    void fetch(`${issuer}/token`, { method: 'POST', body: new URLSearchParams({ ...body, code_verifier: verifier }) })
      .then((response) => response.json())
      .then(saveTokens);
  }, [issuer, clientId, redirectUri]);

  async function logIn() {
    const verifier = randomPKCECodeVerifier();
    const state = randomState();
    sessionStorage.setItem('pkce', JSON.stringify({ verifier, state }));
    const url = new URL(`${issuer}/authorize`);
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'openid profile',
      redirect_uri: redirectUri,
      state,
      code_challenge: await calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
    }).toString();
    window.location.assign(url);
  }

  async function loadReport() {
    const headers = { Authorization: `Bearer ${localStorage.getItem('access_token')}` };
    const response = await fetch('/api/problem/admin-report', { headers });
    setReport(`${response.status}\n${JSON.stringify(await response.json(), null, 2)}`);
  }

  if (!idToken) {
    return (
      <div className="actions">
        <button type="button" onClick={logIn}>
          Log in (tokens kept in localStorage)
        </button>
      </div>
    );
  }

  // Decoded, not verified: code in the browser cannot keep a key secret, so it cannot prove anything.
  const claims = decodeJwt(idToken);
  // BUG 2: the only role check in this version decides whether a button is rendered.
  const isAdmin = Array.isArray(claims.groups) && claims.groups.includes('katas-admins');

  return (
    <>
      <p>
        Signed in as <strong>{String(claims.name ?? claims.sub)}</strong>
      </p>
      <div className="actions">
        {isAdmin && (
          <button type="button" onClick={loadReport}>
            Admin report
          </button>
        )}
        <button type="button" onClick={() => saveTokens(null)}>
          Log out
        </button>
      </div>
      {report && <pre>{report}</pre>}
    </>
  );
}
