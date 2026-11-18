const github = 'https://github.com';
export const maxImageBytes = 4 * 1024 * 1024;

export function pullRepository(pullUrl: string) {
  return /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+\/?$/i.exec(pullUrl)?.[1] ?? '';
}

export function prImageUrl(source: string, pullUrl: string, head: string): string | null {
  if (!source || source.length > 4096 || /[\\\u0000-\u001f]/.test(source)) return null;
  const repository = pullRepository(pullUrl);
  const base = repository && /^[a-f0-9]{40}$/i.test(head)
    ? `${github}/${repository}/raw/${head}/`
    : github;
  try {
    const url = new URL(source, source.startsWith('/') ? github : base);
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 4096 ? url.href : null;
  } catch {
    return null;
  }
}

export function repositoryImage(source: string, repository: string) {
  try {
    const url = new URL(source);
    const raw = url.origin === 'https://raw.githubusercontent.com';
    if ((!raw && url.origin !== github) || url.username || url.password) return null;
    const [owner, repo, ...route] = url.pathname.slice(1).split('/').map(decodeURIComponent);
    if (`${owner}/${repo}`.toLowerCase() !== repository.toLowerCase()) return null;
    if (!raw && route[0] !== 'raw' && route[0] !== 'blob') return null;
    if (!raw) route.shift();
    const hasRefPrefix = route[0] === 'refs' && (route[1] === 'heads' || route[1] === 'tags');
    const refParts = route.splice(0, hasRefPrefix ? 3 : 1);
    const refName = refParts.at(-1);
    if (hasRefPrefix && refParts.length !== 3) return null;
    if (!refName || !/^[\w.-]+$/.test(refName) || refName === '.' || refName === '..' || !route.length) return null;
    const path = route;
    if (path.some(part => !part || part === '.' || part === '..' || /[\/\\\u0000-\u001f\u007f]/.test(part))) return null;
    return { ref: refParts.join('/'), path: path.map(encodeURIComponent).join('/') };
  } catch {
    return null;
  }
}
