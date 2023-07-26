import { Extension } from '@tiptap/core';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Plugin } from 'prosemirror-state';

export class Search {
  constructor() {
    this.options = {};
    this.results = [];
    this.searchTerm = null;
    this._updating = false;
  }
  get findRegExp() {
    return RegExp(this.searchTerm, !this.options.caseSensitive ? 'gui' : 'gu');
  }
  get decorations() {
    return this.results.map((deco) =>
      Decoration.inline(deco.from, deco.to, { class: this.options.findClass })
    );
  }
  _search(doc) {
    this.results = [];
    const mergedTextNodes = [];
    let index = 0;

    if (!this.searchTerm) {
      return;
    }

    doc.descendants((node, pos) => {
      if (node.isText) {
        if (mergedTextNodes[index]) {
          mergedTextNodes[index] = {
            text: mergedTextNodes[index].text + node.text,
            pos: mergedTextNodes[index].pos,
          };
        } else {
          mergedTextNodes[index] = {
            text: node.text,
            pos,
          };
        }
      } else {
        index += 1;
      }
    });

    mergedTextNodes.forEach(({ text, pos }) => {
      const search = this.findRegExp;
      let m;
      // eslint-disable-next-line no-cond-assign
      while ((m = search.exec(text))) {
        if (m[0] === '') {
          break;
        }

        this.results.push({
          from: pos + m.index,
          to: pos + m.index + m[0].length,
        });
      }
    });
  }
  replace(replace) {
    return ({ tr, dispatch }) => {
      const firstResult = this.results[0];

      if (!firstResult) {
        return;
      }

      const { from, to } = this.results[0];
      dispatch(tr.insertText(replace, from, to));
      this.find(this.searchTerm);
    };
  }

  rebaseNextResult(replace, index, lastOffset = 0) {
    const nextIndex = index + 1;

    if (!this.results[nextIndex]) {
      return null;
    }

    const { from: currentFrom, to: currentTo } = this.results[index];
    const offset = currentTo - currentFrom - replace.length + lastOffset;
    const { from, to } = this.results[nextIndex];

    this.results[nextIndex] = {
      to: to - offset,
      from: from - offset,
    };

    return offset;
  }

  replaceAll(replace) {
    return ({ tr, dispatch }) => {
      let offset;

      if (!this.results.length) {
        return;
      }

      this.results.forEach(({ from, to }, index) => {
        tr.insertText(replace, from, to);
        offset = this.rebaseNextResult(replace, index, offset);
      });

      dispatch(tr);

      this.find(this.searchTerm);
    };
  }

  find(searchTerm, useRegex) {
    return ({ tr, dispatch }) => {
      this.searchTerm =
        this.options.disableRegex || !useRegex
          ? searchTerm.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
          : searchTerm;

      this.updateView(tr, dispatch);
    };
  }

  clear() {
    return ({ tr, dispatch }) => {
      this.searchTerm = null;

      this.updateView(tr, dispatch);
    };
  }

  updateView(tr, dispatch) {
    this._updating = true;
    dispatch(tr);
    setTimeout(() => {
      this._updating = false;
    }, 100);
  }

  createDeco(doc) {
    this._search(doc);

    return this.decorations ? DecorationSet.create(doc, this.decorations) : [];
  }
}

const search = new Search();

export default Extension.create({
  name: 'search',
  defaultOptions: {
    autoSelectNext: true,
    findClass: 'find',
    searching: false,
    caseSensitive: false,
    disableRegex: true,
    alwaysSearch: false,
  },
  addCommands() {
    search.options = this.options;

    return {
      find: (attrs, useRegex) => search.find(attrs, useRegex),
      replace: (attrs) => search.replace(attrs),
      replaceAll: (attrs) => search.replaceAll(attrs),
      clearSearch: () => search.clear(),
    };
  },
  addProseMirrorPlugins() {
    search.options = this.options;

    return [
      new Plugin({
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply: (tr, old) => {
            if (
              search._updating ||
              this.options.searching ||
              (tr.docChanged && this.options.alwaysSearch)
            ) {
              return search.createDeco(tr.doc);
            }

            if (tr.docChanged) {
              return old.map(tr.mapping, tr.doc);
            }

            return old;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
