# Blur

Blur distracting or sensitive page content before it reaches your screen share, recording or line of sight.

## Features

- Blur every image and video on selected websites.
- Keep separate profiles for different sites or tasks.
- Tune blur strength from 0–100%.
- Pick individual page elements and remember their CSS selectors.
- Pick a section to find and blur its text, images, videos and form controls.
- Reveal an individual blurred image, video, CSS background or remembered section from its hover controls.
- Reapply remembered rules after reloads and to content added by dynamic websites.
- Pause one profile or the whole extension.

## Use Blur

1. Install Blur and open a normal website.
2. Open the extension popup.
3. Select **Use this site** to add the current domain to the default profile.
4. Adjust the blur strength and choose whether to blur every image and video.
5. Select **Pick element** or **Pick section**, then choose content on the page.

The popup closes while picking. In section mode, Blur compares nearby ancestors using repeated data attributes, roles, classes and parent structures, then applies the rule to **every card sharing the inferred component type**. Press `↑` for a broader parent or `↓` for a narrower child, and press `Esc` to cancel selection. Blur saves changes automatically.

## Profiles and site patterns

Each profile contains its own site patterns, strength and remembered selections. Enter one pattern per line:

- `example.com` — this exact hostname
- `*.example.com` — the hostname and all its subdomains
- `example.com/account/*` — matching paths on the hostname
- `https://example.com/private/*` — a complete URL pattern
- `*` — every HTTP and HTTPS website

All enabled profiles matching the current page are applied. Where rules overlap, Blur uses the stronger setting.

## How section selection works

An element selection blurs the selected node as one visual object. A section selection walks the selected container, wraps visible text fragments and marks its images, videos, CSS backgrounds and form controls separately. A `MutationObserver` applies the same treatment to content inserted later by single-page applications.

Blur tracks why each target is blurred. If an image is covered by both the profile’s media default and a section rule, **Reveal section** temporarily overrides both sources for every item in that section. **Reveal image** still controls media independently while its section remains blurred.

Blur stores the generated CSS selector, not the selected text or media. IDs and stable class names are preferred, with a short structural selector as a fallback.

## Performance

The content script runs at `document_start`, reads matching profiles and installs blur classes before most page content is parsed. This avoids the usual visible flash on normal navigations. Chrome storage and page execution are asynchronous, so an absolute zero-frame guarantee is not possible on every website.

New and replaced images or videos are guarded synchronously, including responsive `src`/`srcset` updates and class replacement by page frameworks. Heavier section text and background detection is batched into animation frames and limited to newly inserted DOM branches. For whole-page defaults, Blur pre-scans likely CSS background candidates and confirms them with computed styles.

## Privacy

Blur has no account, licence key, analytics, telemetry, tracking, advertising, remote scripts or external API calls. It stores settings only in `chrome.storage.local`.

Stored settings include:

- Profile names and enabled states
- Site and URL patterns
- Blur strength
- CSS selectors and short labels describing remembered selections

Page text, images, videos, browsing history and blurred content are not collected or transmitted.

## Permissions

- **Access to all sites** lets the document-start content script apply profiles on websites you configure. Profiles with no matching site pattern do nothing.
- **Storage** keeps profiles and selectors locally.
- **Active tab** lets the popup start element or section selection on the current page.

Chrome prevents extensions from changing protected pages such as `chrome://` URLs and the Chrome Web Store.

## Development

Blur is a dependency-free Manifest V3 extension with no build step.

Run its checks:

```sh
pnpm check
pnpm test
```

To test a local checkout:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this repository.
4. Reload an already-open website once after the first install.

## Limitations

- Websites that replace IDs or class names between visits may require a selection to be recreated.
- Cross-origin iframe contents are not blurred.
- A CSS background attached to a container cannot be filtered separately from that container’s foreground content. Blur therefore treats the element as one visual target.
- CSS backgrounds with no inline style, semantic class or role may only be detected when hovered or selected as part of a section.
- Page-level CSS filters can affect how a nested reveal appears.
