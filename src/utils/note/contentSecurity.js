const IMAGE_SOURCE_PREFIXES = ['assets://', 'blob:', 'data:'];
const MEDIA_SOURCE_PREFIXES = ['assets://', 'file-assets://', 'blob:'];

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
      ...node.attrs,
      src: safeSrc,
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
      ...node.attrs,
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

  doc.querySelectorAll('iframe').forEach(replaceWithText);

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

  return doc.body.innerHTML;
}
