# PiggieTV Signup And Invites

PiggieTV uses jfa-go as the invite and signup engine. The PTV frontend owns the native shell, routing, and dashboard surfaces; jfa-go keeps owning account creation, invite validation, email, password reset, approval, and profile logic.

## Frontend Routes

Public signup:

```text
#/signup
```

The route opens a fullscreen PiggieTV iframe shell pointed at:

```text
https://signup.piggietv.com/invite/ysBDoDSMpv5fFMz9GPMxUL
```

If the portal blocks iframe embedding through CSP or `X-Frame-Options`, PTV shows a fallback button that opens the invite portal in a new tab.

Admin signup management:

```text
#/dashboard/users/signup-invites
```

The first version embeds the jfa-go admin panel and exposes a native PiggieTV control shell. Native invite create/disable/copy actions should call a server-side proxy before they are enabled.

## Secure Proxy Shape

Do not expose jfa-go admin tokens in frontend JavaScript.

Preferred production flow:

```text
PTV frontend
  -> Jellyfin-authenticated PTV backend/helper
    -> jfa-go API
```

Suggested PTV proxy endpoints:

```text
GET    /Ptv/v1/JfaGo/Status
GET    /Ptv/v1/JfaGo/Invites
POST   /Ptv/v1/JfaGo/Invites
DELETE /Ptv/v1/JfaGo/Invites/{code}
```

Read and write invite actions should be admin-only because invites can create real Jellyfin users.

## Node/Express Helper Example

This is a standalone helper shape. The same contract can later move into the PiggieTV Jellyfin plugin.

```js
import express from 'express';

const app = express();
const jfaGoBaseUrl = process.env.JFA_GO_URL || 'http://10.16.0.50:8056';
const jfaGoToken = process.env.JFA_GO_API_TOKEN;

app.use(express.json({ limit: '64kb' }));

function requireJellyfinAdmin(req, res, next) {
  // Validate the Jellyfin access token server-side, then check admin policy.
  // Never trust a client-provided "isAdmin" flag.
  if (!req.user?.isAdministrator) {
    res.status(403).json({ code: 'PTV_SIGNUP_FORBIDDEN', error: 'Admin access required.' });
    return;
  }

  next();
}

async function callJfaGo(path, options = {}) {
  if (!jfaGoToken) {
    throw new Error('JFA_GO_API_TOKEN is not configured.');
  }

  const response = await fetch(`${jfaGoBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${jfaGoToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(body?.error || `jfa-go returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}

app.get('/Ptv/v1/JfaGo/Status', requireJellyfinAdmin, (_req, res) => {
  res.json({
    connected: true,
    engine: 'jfa-go',
    upstream: jfaGoBaseUrl
  });
});

app.get('/Ptv/v1/JfaGo/Invites', requireJellyfinAdmin, async (_req, res, next) => {
  try {
    res.json(await callJfaGo('/invites'));
  } catch (err) {
    next(err);
  }
});

app.post('/Ptv/v1/JfaGo/Invites', requireJellyfinAdmin, async (req, res, next) => {
  try {
    res.json(await callJfaGo('/invites', {
      body: JSON.stringify(req.body),
      method: 'POST'
    }));
  } catch (err) {
    next(err);
  }
});

app.delete('/Ptv/v1/JfaGo/Invites/:code', requireJellyfinAdmin, async (req, res, next) => {
  try {
    res.json(await callJfaGo(`/invites/${encodeURIComponent(req.params.code)}`, {
      method: 'DELETE'
    }));
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({
    code: 'PTV_SIGNUP_PROXY_ERROR',
    error: err.message || 'Signup proxy failed.'
  });
});
```

## Nginx Proxy Manager

For `signup.piggietv.com`:

```text
Scheme: http
Forward Hostname / IP: 10.16.0.50
Forward Port: 8056
Websockets Support: enabled
Block Common Exploits: enabled
```

Recommended advanced headers:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
```

If iframe embedding is blocked, remove or relax only the relevant frame headers for trusted PiggieTV origins. Do not broadly disable security headers for unrelated hosts.

Example CSP direction:

```nginx
add_header Content-Security-Policy "frame-ancestors 'self' https://piggietv.com" always;
```

## Optional Subpath

Subdomain deployment is preferred:

```text
https://signup.piggietv.com
```

If a subpath is required, keep jfa-go assets and redirects under the same prefix:

```text
https://piggietv.com/signup/
```

NPM custom location example:

```nginx
location /signup/ {
    proxy_pass http://10.16.0.50:8056/;
    proxy_set_header Host signup.piggietv.com;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /signup;
}
```

## Production Notes

- Keep Authentik/Jellyfin authentication unchanged.
- Keep jfa-go admin credentials and API tokens server-side only.
- Prefer a Jellyfin plugin proxy long term so the dashboard can reuse Jellyfin authorization policies.
- Keep iframe sandboxing enabled for public signup and embedded admin views.
- Use the native PTV dashboard only for actions that are protected by a backend admin check.
- QR codes, invite analytics, and approval queue UI should read from the proxy, not from direct jfa-go frontend calls.
