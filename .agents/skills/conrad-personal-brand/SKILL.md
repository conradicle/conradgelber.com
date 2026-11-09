---
name: conrad-personal-brand
description: Apply Conrad Gelber's verified personal brand, visual system, typography, voice, and site conventions to personal portfolio content and branded design. Always check the live website and latest code before implementation.
---

# Conrad Personal Brand

Verified source snapshot: November 9, 2026.
Source: https://conradgelber.com and GitHub repository `conradicle/conradgelber.com`, particularly `index.html`, `theme.css`, `style.css`, and `js/site-ui.css`. Treat the current live site as the authority if it differs from this document.

## Brand positioning
Conrad is a Miami Beach student civic leader, builder, researcher, and aspiring diplomat. His work connects local-government transparency, civic technology, international politics, cybersecurity interests, and institutional trust. The live homepage says: "I build things that make government easier to understand, and I am interested in how technology and security shape the world."

Use a grounded, direct, thoughtful, first-person editorial voice. Lead with demonstrated accomplishments rather than abstract claims. Avoid hype and generic phrases like "visionary leader" or "passionate changemaker." Distinguish current experience from goals; never describe him as an established diplomat or cybersecurity expert. Verify roles, impact figures, and awards before using them. Civic-information projects are nonpartisan. Keep personal opinions separate from any organization's official position.

## Information architecture
The six primary sections are **Work**, **Built**, **Writing**, **Next**, **Off the clock**, and **Games**. Preserve the combination of public-interest work, independent development, substantive essays, future goals, and personality. The footer includes contact, LinkedIn, GitHub, Accessibility, Changelog, and a disclaimer that views are personal. Do not impose this personal brand on separate organizations' identities.

## Exact color tokens
The website defaults to dark mode and supports a visitor-selectable light mode. These values are from `theme.css`:

| CSS variable | Dark/default | Light |
| --- | --- | --- |
| `--paper` | `#05090d` | `#eef0f3` |
| `--surface` | `#0c141c` | `#f8f9fa` |
| `--surface-elevated` | `#131f2a` | `#ffffff` |
| `--ink` | `#eaf0f2` | `#13233c` |
| `--ink-soft` | `#b6c5cc` | `#4a5870` |
| `--rule` | `#526267` | `#c7cdd7` |
| `--accent` | `#9bd2d6` | `#14675e` |

Use CSS variables instead of scattered hard-coded colors. The page's HTML metadata separately uses browser `theme-color: #13233C`. The dark homepage hero customizes link and underline colors (`#eaf0f2` and `#8eaab1`), link hover (`#a9d7dc`), and secondary text (`#c3ced1`); do not treat those as global tokens. The atmospheric hero has a jellyfish canvas, hidden in light mode. Never replace this palette with the navy-and-gold identity of Miami-Dade Commission Watch.

## Typography and fonts
**Spectral** is the self-hosted serif typeface for headings, mastheads, and editorial accents, with normal weights 400, 500, 600; fallback Georgia, serif. **IBM Plex Sans** is the self-hosted body, navigation, and interface typeface, weights 400–500; fallback system-ui, -apple-system, Segoe UI, sans-serif.

- Default body: `17px`, line-height `1.62`, reduced to `16px` at <=640px.
- Masthead h1: Spectral 600, `clamp(2.7rem, 8.4vw, 4.9rem)`, line-height `1.02`, letter-spacing `-0.022em`.
- Standfirst: Spectral, `clamp(1.12rem, 2.4vw, 1.4rem)`, line-height `1.5`, max-width `46ch`.
- Section h2: Spectral 500, `1.5rem`, letter-spacing `-0.01em`.
- Subpage h1: Spectral 500, `clamp(1.75rem, 4.4vw, 2.1rem)`, line-height `1.2`.
- Item headings: Spectral 600, typically `1.1rem`–`1.17rem`.
- Navigation: IBM Plex Sans `.95rem`, 44px minimum interaction height.
- Prose width: `63ch`.

The repository self-hosts fonts in `/fonts/`. Reference existing fonts when editing that site. Do not redistribute font binaries as part of outputs; for independent branded work, use appropriately licensed copies of the families.

## Layout and components
- The main centered column has `max-width: 920px` and horizontal padding `clamp(1.25rem, 5vw, 3.5rem)`.
- Use understated, content-first, editorial structure; readable spacing, elegant typography, subtle separators, very few boxed cards.
- Sections have `3.2rem` top padding; section titles use a thin 1px rule and `1.6rem` lower margin.
- List and docket entries use 1px rules. Desktop dated entries pair an `8.5rem` metadata column with content, separated by `1.75rem`, stacking on narrow screens.
- Inline links use a 1px accent underline, accent hover state, and a 2px accent focus outline with 3px offset.
- Tabs use a bottom rule and 3px accent underline for the active tab. At <=560px, the six navigation tabs form a three-column/two-row grid.
- Homepage masthead: two-line name and standfirst on left, circular 220px portrait on right. At <=640px, the 160px portrait stacks above text.
- Utility controls have restrained 2px rounding. Avoid glassmorphism, arbitrary gradients, noisy shadows, pill-heavy dashboards, and generic SaaS templates.
- Interaction is functional and accessible. Respect keyboard navigation and `prefers-reduced-motion`. Document view transitions are about 220ms.

## Working rules
1. Inspect the current deployed pages and source CSS before implementing site designs. If the snapshot conflicts with live reality, follow the current site.
2. Preserve responsive layouts, contrast, keyboard controls, and both themes.
3. Favor precise, verifiable language and the site's understated editorial identity.
4. Treat the personal website as a distinct brand from any nonprofit or institutional project.
5. Before changing website source, read `CLAUDE.md` and respect its changelog, indexing, and privacy conventions. This skill does not authorize deployment.
6. Never put secrets, authentication mechanics, or private implementation details into public material.
