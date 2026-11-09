/**
 * Transactional email via Resend. All operational/transactional email in the app
 * goes through here. If RESEND_API_KEY is unset, sending is a graceful no-op so
 * flows still work in dev / self-host (callers surface a fallback, e.g. a link).
 */
export interface EmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

const DEFAULT_FROM = 'HyphaeHub <notifications@hyphaehub.io>';

export interface SendResult {
  sent: boolean;
  error?: string;
}

export async function sendEmail(
  env: EmailEnv,
  msg: { to: string; subject: string; html: string; text?: string },
): Promise<SendResult> {
  if (!env.RESEND_API_KEY) return { sent: false, error: 'email-not-configured' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || DEFAULT_FROM,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { sent: false, error: `resend-${res.status}: ${body.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'send-failed' };
  }
}

const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch,
  );

/** The buyer storefront magic-link invite. */
export function buyerInviteEmail(farmName: string, inviteUrl: string) {
  const safeFarm = esc(farmName);
  const subject = `${farmName} invited you to their HyphaeHub storefront`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f2ea;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#2b2420">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-size:22px;font-weight:800;color:#241e1a">Hyphae<span style="color:#53713c">Hub</span></div>
    <div style="background:#fff;border:1px solid #ece7da;border-radius:16px;padding:24px;margin-top:16px">
      <h1 style="font-size:20px;margin:0 0 8px">${safeFarm} invited you to their storefront</h1>
      <p style="color:#5b5149;line-height:1.6;margin:0 0 20px">See what ${safeFarm} has available (and what's coming soon), and call dibs on what you want. This link signs you in — keep it private.</p>
      <a href="${inviteUrl}" style="display:inline-block;background:#53713c;color:#f6f2ea;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Open the storefront →</a>
      <p style="color:#9a8f84;font-size:12px;margin:20px 0 0">If the button doesn't work, paste this link into your browser:<br>${esc(inviteUrl)}</p>
    </div>
    <p style="color:#9a8f84;font-size:12px;text-align:center;margin-top:16px">Sent by HyphaeHub on behalf of ${safeFarm}.</p>
  </div></body></html>`;
  const text = `${farmName} invited you to their HyphaeHub storefront.\n\nOpen it (this link signs you in — keep it private):\n${inviteUrl}\n`;
  return { subject, html, text };
}

/** Shared shell for a simple branded HyphaeHub email. */
function shell(heading: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#f6f2ea;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#2b2420">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-size:22px;font-weight:800;color:#241e1a">Hyphae<span style="color:#53713c">Hub</span></div>
    <div style="background:#fff;border:1px solid #ece7da;border-radius:16px;padding:24px;margin-top:16px">
      <h1 style="font-size:20px;margin:0 0 8px">${esc(heading)}</h1>
      ${bodyHtml}
    </div>
    <p style="color:#9a8f84;font-size:12px;text-align:center;margin-top:16px">HyphaeHub · cultivation tracking</p>
  </div></body></html>`;
}

/** "You're on the early-access list" confirmation. */
export function waitlistConfirmEmail() {
  const subject = "You're on the HyphaeHub early-access list";
  const html = shell(
    "You're on the list",
    `<p style="color:#5b5149;line-height:1.6;margin:0">Thanks for your interest in HyphaeHub. We'll email you the moment early access opens. In the meantime, the free grow calculators are live at <a href="https://hyphaehub.io/tools" style="color:#53713c">hyphaehub.io/tools</a>.</p>`,
  );
  const text = "You're on the HyphaeHub early-access list. We'll email you when access opens.\n";
  return { subject, html, text };
}

/** "Early access is open — come in" invite. */
export function waitlistInviteEmail(appUrl: string) {
  const subject = 'Your HyphaeHub early access is open';
  const html = shell(
    'Early access is open',
    `<p style="color:#5b5149;line-height:1.6;margin:0 0 20px">You're in. Create your account and start tracking your grow.</p>
     <a href="${esc(appUrl)}" style="display:inline-block;background:#53713c;color:#f6f2ea;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Get started →</a>`,
  );
  const text = `Your HyphaeHub early access is open. Get started: ${appUrl}\n`;
  return { subject, html, text };
}
