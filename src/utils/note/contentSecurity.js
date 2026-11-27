const IMAGE_SOURCE_PREFIXES = ['assets://', 'file-assets://', 'blob:', 'data:image/', 'resource://'];
const MEDIA_SOURCE_PREFIXES = ['assets://', 'file-assets://', 'blob:'];
// File-attachment blocks legitimately carry inline data: payloads of any mime
// type (share-import embeds PDFs/office files as data: URLs — importFile.ts).
const FILE_SOURCE_PREFIXES = ['assets://', 'file-assets://', 'blob:', 'data:', 'resource://'];

function normalizeSourceValue(value) {
  return String(value || '').trim();
}

function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function startsWithAny(value, prefixes) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function isRelativeSource(value) {
  return (
    !!value &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) &&
    !value.startsWith('//')
  );
}

export function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeImageSource(value, options = {}) {
  const source = normalizeSourceValue(value);
  if (!source) return '';

  if (startsWithAny(source, IMAGE_SOURCE_PREFIXES) || isHttpsUrl(source)) {
    return source;
  }

  if (options.allowRelative && isRelativeSource(source)) {
    return source;
  }

  return '';
}

export function sanitizeMediaSource(value, options = {}) {
  const source = normalizeSourceValue(value);
  if (!source) return '';

  if (startsWithAny(source, MEDIA_SOURCE_PREFIXES) || isHttpsUrl(source)) {
    return source;
  }

  if (options.allowRelative && isRelativeSource(source)) {
    return source;
  }

  return '';
}

export function sanitizeFileSource(value, options = {}) {
  const source = normalizeSourceValue(value);
  if (!source) return '';

  if (startsWithAny(source, FILE_SOURCE_PREFIXES) || isHttpsUrl(source)) {
    return source;
  }

  if (options.allowRelative && isRelativeSource(source)) {
    return source;
  }

  return '';
}

/**
 * Single shared gate for image/video srcs reaching stored note content
 * (SC-4-02/SC-4-04). Fresh markdown imports and the JSON/Yjs content path
 * both funnel through here (directly or via sanitizeNoteContent callers).
 *
 * Allowed: first-party asset schemes (assets://, file-assets:// — served by
 * the Rust asset protocol), ephemeral blob: URLs, remote https: images (an
 * explicit product feature — markdown import keeps remote srcs), and inline
 * data: payloads restricted to image/* and video/*.
 * Refused: file:, http: (cleartext + tracking), javascript:/vbscript:,
 * protocol-relative URLs, relative paths, and every other data: mime
 * (notably data:text/html). Blocked srcs must be dropped with a console
 * warn, never rendered.
 */
export function isAllowedContentMediaSrc(value) {
  const source = normalizeSourceValue(value);
  if (!source || /[\s\0-\x1f\x7f]/.test(source)) return false;
  const lower = source.toLowerCase();
  return (
    lower.startsWith('assets://') ||
    lower.startsWith('file-assets://') ||
    lower.startsWith('blob:') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:image/') ||
    lower.startsWith('data:video/')
  );
}

/**
 * Scheme gate for window.open targets (SC-4-08). Only schemes safe to hand
 * to the OS/webview opener pass; note:// is routed internally by the callers
 * and must never reach window.open.
 */
export function isSafeOpenUrl(value) {
  try {
    const protocol = new URL(String(value || '')).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * Internal note-target gate (SC-4-02 linkNote). Every in-app producer emits
 * `note://<id>` exclusively, so classification and rendering only ever honor
 * that shape — anything else (javascript:, file:, http:) is refused.
 */
export function isNoteHref(value) {
  return typeof value === 'string' && value.startsWith('note://');
}

export function buildIframeFallbackText(src = '') {
  const value = normalizeSourceValue(src);
  return value
    ? `<iframe src="${escapeHtmlAttribute(value)}"></iframe>`
    : '<iframe></iframe>';
}

export function buildImageFallbackText(attrs = {}) {
  const src = normalizeSourceValue(attrs?.src);
  const alt = normalizeSourceValue(attrs?.alt);
  const srcAttr = src ? ` src="${escapeHtmlAttribute(src)}"` : '';
  const altAttr = alt ? ` alt="${escapeHtmlAttribute(alt)}"` : '';
  return `<img${srcAttr}${altAttr}>`;
}

export function buildMediaFallbackText(tagName, attrs = {}) {
  const tag = tagName === 'audio' ? 'audio' : 'video';
  const src = normalizeSourceValue(attrs?.src);
  const srcAttr = src ? ` src="${escapeHtmlAttribute(src)}"` : '';
  return `<${tag}${srcAttr}></${tag}>`;
}

function createTextNode(text) {
  return { type: 'text', text };
}

function createParagraphNode(text) {
  return {
    type: 'paragraph',
    content: [createTextNode(text)],
  };
}

export function createFallbackNode(text, parentType = '') {
  if (parentType === 'paragraph') {
    return createTextNode(text);
  }

  return createParagraphNode(text);
}

export function createMediaFallbackNode(kind, attrs = {}, parentType = '') {
  if (kind === 'iframe') {
    return createFallbackNode(buildIframeFallbackText(attrs?.src), parentType);
  }

  if (kind === 'image') {
    return createFallbackNode(buildImageFallbackText(attrs), parentType);
  }

  return createFallbackNode(
    buildMediaFallbackText(kind === 'audio' ? 'audio' : 'video', attrs),
    parentType
  );
}

function sanitizeNode(node, parentType = '') {
  if (!node || typeof node !== 'object') {
    return node;
  }

  if (node.type === 'iframe') {
    return createMediaFallbackNode('iframe', node.attrs, parentType);
  }

  const nextNode = { ...node };

  if (Array.isArray(node.content)) {
    nextNode.content = node.content
      .map((child) => sanitizeNode(child, node.type))
      .flat()
      .filter(Boolean);
  }

  if (node.type === 'image') {
    const safeSrc = sanitizeImageSource(node?.attrs?.src);
    if (!safeSrc) {
      return createMediaFallbackNode('image', node.attrs, parentType);
    }

    nextNode.attrs = {
      src: safeSrc,
      alt: node.attrs?.alt,
      title: node.attrs?.title,
    };
    return nextNode;
  }

  if (node.type === 'Audio' || node.type === 'Video') {
    const safeSrc = sanitizeMediaSource(node?.attrs?.src);
    if (!safeSrc) {
      return createMediaFallbackNode(
        node.type === 'Audio' ? 'audio' : 'video',
        node.attrs,
        parentType
      );
    }

    nextNode.attrs = {
      src: safeSrc,
    };
  }

  return nextNode;
}

export function sanitizeNoteContent(content) {
  if (!content || typeof content !== 'object') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((node) => sanitizeNode(node))
      .flat()
      .filter(Boolean);
  }

  if (!Array.isArray(content.content)) {
    return content;
  }

  return {
    ...content,
    content: content.content
      .map((node) => sanitizeNode(node, content.type))
      .flat()
      .filter(Boolean),
  };
}

export function sanitizeImportedHtml(html, options = {}) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || '', 'text/html');
  const allowRelative = !!options.allowRelative;

  const replaceWithText = (element) => {
    element.replaceWith(doc.createTextNode(element.outerHTML || ''));
  };

  doc.querySelectorAll('script, style, link, base, form, meta').forEach(replaceWithText);

  // Unwrap containers whose children carry real content (Apple Notes wraps
  // tables and attachments in <object>); textifying them dumps raw markup.
  doc.querySelectorAll('object, embed').forEach((element) => {
    element.replaceWith(...element.childNodes);
  });
  doc.querySelectorAll('iframe').forEach((element) => {
    element.remove();
  });

  doc.querySelectorAll('img').forEach((img) => {
    const safeSrc = sanitizeImageSource(img.getAttribute('src'), {
      allowRelative,
    });

    if (!safeSrc) {
      replaceWithText(img);
      return;
    }

    img.setAttribute('src', safeSrc);
  });

  doc.querySelectorAll('video, audio').forEach((media) => {
    let hasSafeSource = false;
    const directSrc = media.getAttribute('src');

    if (directSrc) {
      const safeSrc = sanitizeMediaSource(directSrc, { allowRelative });
      if (safeSrc) {
        media.setAttribute('src', safeSrc);
        hasSafeSource = true;
      } else {
        media.removeAttribute('src');
      }
    }

    media.querySelectorAll('source').forEach((source) => {
      const safeSrc = sanitizeMediaSource(source.getAttribute('src'), {
        allowRelative,
      });

      if (!safeSrc) {
        source.remove();
        return;
      }

      source.setAttribute('src', safeSrc);
      hasSafeSource = true;
    });

    if (!hasSafeSource) {
      replaceWithText(media);
    }
  });

  return doc;
}
