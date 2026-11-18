import { git } from './git';
import { ghImage } from './pr-cli';
import { maxImageBytes, repositoryImage } from './pr-image-source';
import { repositoryFromRemote } from './pr-provider';

function imageMime(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png' as const;
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg' as const;
  const header = bytes.toString('ascii', 0, 6);
  if (header === 'GIF89a' || header === 'GIF87a') return 'image/gif' as const;
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp' as const;
  return null;
}

export async function readPrImage(
  cwd: string,
  source: string,
  signal?: AbortSignal,
  runGit = git,
  download = ghImage,
) {
  const repo = repositoryFromRemote(await runGit(cwd, ['remote', 'get-url', 'origin'], signal));
  const image = repositoryImage(source, repo);
  if (!image) throw Error('Image must point to a file in the selected GitHub repository.');
  const endpoint = `repos/${repo}/contents/${image.path}?ref=${encodeURIComponent(image.ref)}`;
  const bytes = await download(cwd, [
    'api', '--hostname', 'github.com', '--method', 'GET', endpoint,
    '-H', 'Accept: application/vnd.github.raw',
  ], signal);
  const mime = imageMime(bytes);
  if (!mime || bytes.length > maxImageBytes) throw Error('Unsupported image or image exceeds the preview size limit.');
  return { mime, base64: bytes.toString('base64') };
}
