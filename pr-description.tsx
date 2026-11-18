import { useEffect, useMemo, useRef, useState } from 'react';
import { UrlLink } from '@get-bb/plugin-sdk/app';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { PrImage } from './pr-contract';
import { prImageUrl, pullRepository, repositoryImage } from './pr-image-source';

export type LoadPrImage = (source: string) => Promise<PrImage>;

function DescriptionImage({ source, alt, load }: { source: string; alt: string; load?: LoadPrImage }) {
  const placeholder = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = placeholder.current;
    if (!load || !element || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [load, visible]);

  useEffect(() => {
    if (!load || !visible) return;
    let active = true;
    let objectUrl = '';
    void load(source).then(({ base64, mime }) => {
      if (!active) return;
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      setPreview(objectUrl);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, load, visible]);

  if (failed) return <span className="pr-image-note">{alt && `${alt} · `}<UrlLink href={source} target="_blank">Open image</UrlLink></span>;
  if (load && !preview) return <span ref={placeholder} className="pr-image-note">{alt || 'Image'} · Loading preview…</span>;
  return <img src={preview || source} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function PrDescription({ body, pullUrl, head, load }: {
  body: string; pullUrl: string; head: string; load?: LoadPrImage;
}) {
  const components = useMemo<Components>(() => ({
    img: ({ src, alt }) => {
      const source = prImageUrl(src ?? '', pullUrl, head);
      if (!source) return alt || null;
      const loadFromRepository = repositoryImage(source, pullRepository(pullUrl)) ? load : undefined;
      return <DescriptionImage key={source} source={source} alt={alt ?? ''} load={loadFromRepository} />;
    },
    a: ({ node: _node, href, ...props }) => <UrlLink href={href ?? ''} {...props} />,
  }), [pullUrl, head, load]);

  return <div className="pr-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={components}>{body}</ReactMarkdown>
  </div>;
}
