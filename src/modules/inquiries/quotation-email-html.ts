import * as fs from 'fs';
import * as path from 'path';
import { ENLIGHT_LOGO_BASE64 } from '../../assets/logoBase64';

export function quotationEmailHtml(text: string): string {
  const body = text
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;line-height:1.55;">${paragraph
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
  const logo =
    '<p style="margin:0 0 16px;"><img src="cid:enlight-logo" alt="Enlight Metals" style="max-width:220px;height:auto;" /></p>';
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c2128;">${body}${logo}</div>`;
}

export function getCompanyLogoBuffer(): Buffer | null {
  const possiblePaths = [
    path.join(process.cwd(), 'assets', 'logo.png'),
    path.join(process.cwd(), 'assets', 'logo.jpg'),
    path.join(process.cwd(), 'assets', 'logo.jpeg'),
    path.join(process.cwd(), 'backend', 'assets', 'logo.png'),
    path.join(process.cwd(), 'dist', 'assets', 'logo.png'),
    path.join(__dirname, '../../../assets/logo.png'),
    path.join(__dirname, '../../../assets/logo.jpg'),
    path.join(__dirname, '../../../assets/logo.jpeg'),
    path.join(__dirname, '../../assets/logo.png'),
    path.join(__dirname, '../assets/logo.png'),
    path.join(__dirname, 'assets/logo.png'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p);
      } catch {}
    }
  }
  if (ENLIGHT_LOGO_BASE64) {
    try {
      return Buffer.from(ENLIGHT_LOGO_BASE64, 'base64');
    } catch {}
  }
  return null;
}
