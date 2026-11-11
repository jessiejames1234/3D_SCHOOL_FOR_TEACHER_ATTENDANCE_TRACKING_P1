<?php

function email_design_escape($value) {
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Lightweight email layout: inline CSS, system fonts, no external assets. */
function email_design_render($category, $title, $content, $preview = '') {
    $safeCategory = email_design_escape($category);
    $safeTitle = email_design_escape($title);
    $safePreview = email_design_escape($preview);
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' . $safeTitle . '</title></head>'
        . '<body style="margin:0;padding:0;background:#f4f7f5;color:#172033;font-family:Arial,Helvetica,sans-serif;">'
        . '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">' . $safePreview . '</div>'
        . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;background:#f4f7f5;"><tr><td align="center" style="padding:24px 12px;">'
        . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;max-width:600px;background:#ffffff;border:1px solid #d8e2dc;border-radius:12px;">'
        . '<tr><td style="padding:22px 24px;background:#168347;border-radius:11px 11px 0 0;color:#ffffff;">'
        . '<p style="margin:0;font-size:17px;font-weight:700;line-height:1.4;">Teacher Attendance</p>'
        . '<p style="margin:5px 0 0;font-size:12px;line-height:1.5;color:#ffffff;">Account &amp; teaching updates</p></td></tr>'
        . '<tr><td style="padding:26px 24px;font-size:14px;line-height:1.65;overflow-wrap:anywhere;word-break:break-word;">'
        . '<p style="margin:0 0 8px;color:#147a40;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">' . $safeCategory . '</p>'
        . '<h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:#172033;font-weight:700;">' . $safeTitle . '</h1>'
        . $content . '</td></tr>'
        . '<tr><td style="padding:16px 24px;border-top:1px solid #e2e8e5;background:#fbfdfc;border-radius:0 0 11px 11px;color:#64748b;font-size:12px;line-height:1.6;">'
        . 'Teacher Attendance &middot; Automated account message<br>If you need assistance, contact your system administrator.'
        . '</td></tr></table></td></tr></table></body></html>';
}

/** Turn existing notification text into mobile-friendly rows without changing its data. */
function email_design_notification_details($details) {
    $details = trim((string)$details);
    // The email already has a short instruction below the details.
    $details = preg_replace('/\s*Open Teaching Schedule to (?:view all assigned classes|review your current classes)\.?\s*/i', ' ', $details);
    $parts = preg_split('/\s*\|\s*|\s+(?=(?:Subject|Class|Section|Room|Schedule|Semester|Before|After):)/i', $details, -1, PREG_SPLIT_NO_EMPTY);
    $html = '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;margin:18px 0;border:1px solid #d8e2dc;border-radius:8px;background:#ffffff;">';
    foreach ($parts as $index => $part) {
        $part = trim($part);
        if ($part === '') continue;
        $label = '';
        $value = $part;
        if (preg_match('/^(Before|After):\s*(.*)$/i', $part, $match)) {
            $html .= '<tr><td style="padding:12px 16px;background:#f0fbf5;color:#147a40;font-size:12px;font-weight:700;">' . email_design_escape(ucfirst(strtolower($match[1]))) . '</td></tr>';
            $value = trim($match[2]);
            if ($value === '') continue;
        }
        if (preg_match('/^(Subject|Class|Section|Room|Schedule|Semester):\s*(.*)$/i', $value, $match)) {
            $label = ucfirst(strtolower($match[1]));
            $value = $match[2];
        } elseif (preg_match('/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d/i', $value)) {
            $label = 'Schedule';
        }
        $html .= '<tr><td style="padding:12px 16px;' . ($index > 0 ? 'border-top:1px solid #e2e8e5;' : '') . 'overflow-wrap:anywhere;word-break:break-word;">'
            . ($label !== '' ? '<p style="margin:0 0 4px;color:#64748b;font-size:11px;line-height:1.5;font-weight:700;">' . email_design_escape($label) . '</p>' : '')
            . '<p style="margin:0;color:#172033;font-size:14px;line-height:1.65;font-weight:400;">' . email_design_escape($value) . '</p></td></tr>';
    }
    return $html . '</table>';
}

function email_design_panel($label, $value, $note = '', $isCode = false) {
    return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;margin:20px 0;background:#f0fbf5;border:1px solid #cce8d8;border-radius:8px;"><tr><td style="padding:18px;">'
        . '<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#285f42;">' . email_design_escape($label) . '</p>'
        . '<p style="margin:0;font-size:' . ($isCode ? '30' : '15') . 'px;line-height:1.5;font-weight:700;color:#116b3a;overflow-wrap:anywhere;word-break:break-word;">' . email_design_escape($value) . '</p>'
        . ($note !== '' ? '<p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#475569;">' . email_design_escape($note) . '</p>' : '')
        . '</td></tr></table>';
}
