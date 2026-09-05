// The active organization (farm) is stored per-browser and sent on every API
// request as X-Workspace-Id, so a user in several orgs can switch between them.
const KEY = 'hh_active_org';

export function getActiveOrg(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setActiveOrg(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // ignore (private mode / storage disabled)
  }
}
