export function isGithubAppEnabled(): boolean {
  return Boolean(import.meta.env.VITE_GITHUB_APP_ENABLED === 'true');
}

export function allowGithubPat(): boolean {
  return import.meta.env.VITE_ALLOW_GITHUB_PAT === 'true';
}
