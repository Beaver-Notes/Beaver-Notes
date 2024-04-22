---
description: >-
  At Beaver, we believe in creating software that is both privacy-friendly and
  accessible to everyone, and you can assist us in achieving this by translating
  Beaver into your own language.
---

# 🗺️ Translate Beaver (Legacy)

Disclaimer: Languages can be added to Beaver Notes regardless of territorial or cultural issues. Our aim is to make note-taking universally accessible, allowing users to choose their preferred language. There's no place for hate and discrimination in this community, so please be respectful and cooperative. Together, we can build an inclusive note-taking experience, benefiting all.

## Getting Started

Before you begin, ensure that you have [setup-your-environment.md](setup-your-environment.md "mention") and have a functioning GitHub account. If everything checks out you can start translating Beaver Notes right away. To begin with download the **'translations-template.json',** rename it using the **ISO 639-1** format. You can find your language code [here](https://en.wikipedia.org/wiki/List\_of\_ISO\_639-1\_codes). and place it in **'/packages/renderer/src/pages/settings/locales,'**

{% file src="../.gitbook/assets/translation-template (1).json" %}

## Translating

Before you start translating the provided templates, it's important to understand their structure. Each section of the app is divided into blocks, like the 'Index' block below. Within each block, you'll find multiple values, as illustrated in the example:

```json
  "index": {
    "newnote": "To create a new note, you can press Ctrl + N, Cmd + N or click the + button on top left",
    "archived": "Archived",
    "bookmarked": "Bookmarked",
    "all": "All"
  },
```

The part you'll be editing is the text that appears after the colon within a value. For instance, in the "newnote" value, the part that requires translation is: 'To create a new note, you can press Ctrl + N, Cmd + N, or click the + button on the top left.'

## Editing the code

Open the '/packages/renderer/src/utils/**commands.js**' file, locate the import section in the file and  add the following lines:

```javascript
import enTranslations from './locales/en.json';

if (selectedLanguage === 'en') {
  translations = enTranslations;
}
```

{% hint style="info" %}
Replace the 'en' abbreviation with your own language's abbreviation in both 'enTranslations' and 'en.json.
{% endhint %}

After that head to '/packages/renderer/src/pages/settings/**Index.vue**' and add the following to the import section

```javascript
import enTranslations from './locales/en.json';
```

Open the '/packages/renderer/src/pages/settings/Index.vue' file, locate the `data()` method, and find the 'languages' section inside it. It should be structured like this:

<pre class="language-javascript"><code class="lang-javascript">  data() {
    return {
      selectedFont: localStorage.getItem('selected-font') || 'Arimo',
      selectedLanguage: localStorage.getItem('selectedLanguage') || 'en', // Initialize with a value from localStorage if available
      languages: [
        <a data-footnote-ref href="#user-content-fn-1">{ code: 'en', name: 'English', translations: enTranslations },</a>
      ],
    };
  },
</code></pre>

Under the 'languages' section, add the following line:

```javascript
{ code: 'en', name: 'English', translations: enTranslations },
```

{% hint style="info" %}
Replace the 'en' code with the code of your own language, as previously done when renaming the two files.
{% endhint %}

You're halfway done! Now, you'll need to navigate to 'packages/renderer/src/lib/tiptap/index.js' and add the following lines:

Under the imports, add:

```javascript
import enTranslations from '../../pages/settings/locales/en.json';
```

Under // Import and assign other languages as needed, add:

```javascript
else if (selectedLanguage === 'en') {
  translations = enTranslations;
}
```

{% hint style="info" %}
Replace the 'en' code with the code of your own language, as previously done when renaming the two files.
{% endhint %}

One last step to go! Now, head to 'packages/renderer/src/components/home/HomeNoteCard.vue' and under the import, add:

```javascript
import 'dayjs/locale/en';
```

{% hint style="info" %}
Replace the 'en' code with the code of your own language, as previously done when renaming the two files.
{% endhint %}

Kudos! You've successfully added support for a new language, making Beaver Notes more accessible to a ton of people. You can now check if everything appears to be correct, and if it is, then feel free to open a pull request on GitHub. It will be promptly reviewed, and unless further verification is needed, it will be added to a new release of the app.

[^1]: 
