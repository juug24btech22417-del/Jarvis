// JARVIS Circle to Search window types.
// Compiled at runtime by scripts/clipboard-watcher.ps1 (Add-Type).
//
// Kept as a real source file rather than an inlined PowerShell blob: a
// 200-line embedded C# blob inside the watcher is exactly the shape
// Windows Defender's AMSI scanner blocks, and a blocked watcher takes
// clipboard intelligence down with it.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class JarvisDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}

public class JarvisHotkeyWindow : NativeWindow {
    [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    private const int WM_HOTKEY = 0x0312;
    public int TriggeredId = 0;
    public JarvisHotkeyWindow() { CreateHandle(new CreateParams()); }
    public bool Register(int id, uint modifiers, uint key) { return RegisterHotKey(Handle, id, modifiers, key); }
    public void Unregister(int id) { UnregisterHotKey(Handle, id); }
    protected override void WndProc(ref Message m) {
        base.WndProc(ref m);
        if (m.Msg == WM_HOTKEY) { TriggeredId = (int)m.WParam; }
    }
    public void Dispose() {
        try { Unregister(777); } catch {}
        try { Unregister(776); } catch {}
        try { DestroyHandle(); } catch {}
    }
}



public class JarvisCircleOverlay : Form {
    private readonly Bitmap _frozen;
    private readonly List<Point> _pts = new List<Point>();
    private bool _drawing = false;

    public bool Cancelled = false;
    public bool HasSelection = false;

    public JarvisCircleOverlay(Bitmap frozen, Rectangle virtualScreen) {
        _frozen = frozen;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Location = virtualScreen.Location;
        Size = virtualScreen.Size;
        DoubleBuffered = true;
        KeyPreview = true;
        Cursor = Cursors.Cross;
        Text = "JARVIS Circle to Search";
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
    }

    protected override void OnShown(EventArgs e) {
        base.OnShown(e);
        Bounds = new Rectangle(Location, Size);
        Activate();
        Focus();
    }

    private GraphicsPath BuildPath(int ox, int oy) {
        GraphicsPath p = new GraphicsPath();
        p.FillMode = FillMode.Winding;
        if (_pts.Count < 2) {
            if (_pts.Count == 1) p.AddEllipse(_pts[0].X + ox - 1, _pts[0].Y + oy - 1, 2, 2);
            return p;
        }
        Point[] arr = new Point[_pts.Count];
        for (int i = 0; i < _pts.Count; i++) arr[i] = new Point(_pts[i].X + ox, _pts[i].Y + oy);
        p.AddLines(arr);
        p.CloseFigure();
        return p;
    }

    public Rectangle SelectionBounds {
        get {
            if (_pts.Count == 0) return Rectangle.Empty;
            int l = int.MaxValue, t = int.MaxValue, r = int.MinValue, b = int.MinValue;
            foreach (Point pt in _pts) {
                if (pt.X < l) l = pt.X;
                if (pt.Y < t) t = pt.Y;
                if (pt.X > r) r = pt.X;
                if (pt.Y > b) b = pt.Y;
            }
            return Rectangle.FromLTRB(l, t, r, b);
        }
    }

    // The crop that goes to the model: the selection plus a little context,
    // with everything outside the drawn loop dimmed to grey so a vision model
    // (and a shopper looking at the card) sees only the circled subject.
    public Bitmap BuildCrop(int maxWidth, bool dimOutside) {
        Rectangle sb = SelectionBounds;
        if (sb.Width < 3 || sb.Height < 3) return null;
        int pad = 14;
        int l = Math.Max(0, sb.Left - pad);
        int t = Math.Max(0, sb.Top - pad);
        int r = Math.Min(_frozen.Width, sb.Right + pad);
        int b = Math.Min(_frozen.Height, sb.Bottom + pad);
        Rectangle box = Rectangle.FromLTRB(l, t, r, b);
        int w = Math.Max(1, box.Width);
        int h = Math.Max(1, box.Height);

        Bitmap crop = new Bitmap(w, h);
        using (Graphics g = Graphics.FromImage(crop)) {
            g.DrawImage(_frozen, new Rectangle(0, 0, w, h), box, GraphicsUnit.Pixel);
            if (dimOutside) {
                using (GraphicsPath path = BuildPath(-box.X, -box.Y)) {
                    Region outside = new Region(new Rectangle(0, 0, w, h));
                    outside.Exclude(path);
                    using (SolidBrush veil = new SolidBrush(Color.FromArgb(205, 116, 118, 126)))
                        g.FillRegion(veil, outside);
                    outside.Dispose();
                }
            }
        }

        if (maxWidth > 0 && crop.Width > maxWidth) {
            int nw = maxWidth;
            int nh = Math.Max(1, (int)Math.Round(crop.Height * (maxWidth / (double)crop.Width)));
            Bitmap small = new Bitmap(nw, nh);
            using (Graphics g2 = Graphics.FromImage(small)) {
                g2.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g2.DrawImage(crop, 0, 0, nw, nh);
            }
            crop.Dispose();
            return small;
        }
        return crop;
    }

    protected override void OnMouseDown(MouseEventArgs e) {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Right) { Cancelled = true; DialogResult = DialogResult.Cancel; Close(); return; }
        _pts.Clear();
        _drawing = true;
        _pts.Add(new Point(e.X, e.Y));
        Invalidate();
    }

    protected override void OnMouseMove(MouseEventArgs e) {
        base.OnMouseMove(e);
        if (!_drawing) return;
        Point last = _pts[_pts.Count - 1];
        double dx = e.X - last.X;
        double dy = e.Y - last.Y;
        if (dx * dx + dy * dy < 9) return; // ~3px: a smooth freehand stroke, not 60 points a second
        _pts.Add(new Point(e.X, e.Y));
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e) {
        base.OnMouseUp(e);
        if (!_drawing) return;
        _drawing = false;
        if (e.Button == MouseButtons.Right) return;
        Rectangle sb = SelectionBounds;
        HasSelection = _pts.Count >= 2 && sb.Width >= 4 && sb.Height >= 4;
        DialogResult = DialogResult.OK;
        Close();
    }

    protected override void OnKeyDown(KeyEventArgs e) {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape) { Cancelled = true; DialogResult = DialogResult.Cancel; Close(); }
        if (e.KeyCode == Keys.Enter && _pts.Count >= 2) {
            HasSelection = true;
            DialogResult = DialogResult.OK;
            Close();
        }
    }

    protected override void OnPaint(PaintEventArgs e) {
        Graphics g = e.Graphics;
        g.DrawImage(_frozen, ClientRectangle);

        if (_pts.Count >= 2) {
            using (GraphicsPath path = BuildPath(0, 0)) {
                Region outside = new Region(ClientRectangle);
                outside.Exclude(path);
                using (SolidBrush veil = new SolidBrush(Color.FromArgb(155, 6, 8, 14)))
                    g.FillRegion(veil, outside);
                outside.Dispose();

                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (Pen glow = new Pen(Color.FromArgb(70, 56, 189, 248), 12f)) {
                    glow.LineJoin = LineJoin.Round; glow.StartCap = LineCap.Round; glow.EndCap = LineCap.Round;
                    g.DrawPath(glow, path);
                }
                using (Pen stroke = new Pen(Color.FromArgb(255, 56, 189, 248), 3.2f)) {
                    stroke.LineJoin = LineJoin.Round; stroke.StartCap = LineCap.Round; stroke.EndCap = LineCap.Round;
                    g.DrawPath(stroke, path);
                }
            }
        } else {
            using (SolidBrush veil = new SolidBrush(Color.FromArgb(72, 6, 8, 14)))
                g.FillRectangle(veil, ClientRectangle);
        }

        string hint = _pts.Count >= 2
            ? "Release to search  -  Esc to cancel"
            : "Draw around anything  -  right-click or Esc to cancel";
        using (Font font = new Font("Segoe UI Semibold", 11f))
        using (SolidBrush fg = new SolidBrush(Color.FromArgb(240, 245, 250)))
        using (SolidBrush bg = new SolidBrush(Color.FromArgb(220, 16, 18, 24))) {
            SizeF sz = g.MeasureString(hint, font);
            float x = (ClientSize.Width - sz.Width) / 2f;
            float y = ClientSize.Height - sz.Height - 70f;
            g.FillRectangle(bg, x - 14f, y - 8f, sz.Width + 28f, sz.Height + 16f);
            g.DrawString(hint, font, fg, x, y);
        }
    }
}

// Live translate-in-place panel.
//
// After a circle has been read and translated, this floats a translucent card
// exactly where the original text was — the user sees the translation sitting
// on top of the thing they circled instead of hunting for it in a card on the
// other side of the screen.
//
// It is deliberately a small, click-dismissable panel rather than a full-screen
// layer: the frozen screenshot it was drawn from is already seconds old, so
// repainting the whole screen would put stale pixels over whatever the user has
// done since. Only the region is covered, and it lifts on click or after a few
// seconds.
public class JarvisTranslatedPanel : Form {
    private readonly string _original;
    private readonly string _translated;
    private readonly int _autoCloseMs;
    private readonly System.Windows.Forms.Timer _life = new System.Windows.Forms.Timer();
    protected override bool ShowWithoutActivation { get { return true; } }

    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE - never steal focus
            return cp;
        }
    }

    public JarvisTranslatedPanel(string original, string translated, Rectangle anchor, int autoCloseMs) {
        _original = original;
        _translated = translated;
        _autoCloseMs = autoCloseMs;

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(24, 26, 33);
        DoubleBuffered = true;
        // A little room under the original text, and never smaller than the
        // thing it replaces where that is possible.
        int w = Math.Max(anchor.Width + 28, 260);
        int lines = translated.Length > 0 ? (translated.Length / 42) + 2 : 2;
        int h = Math.Max(anchor.Height + 24, 54 + lines * 20);
        w = Math.Min(w, 620);
        h = Math.Min(h, 340);
        Size = new Size(w, h);
        Location = new Point(anchor.X - 14, anchor.Y - 12);
    }

    protected override void OnShown(EventArgs e) {
        base.OnShown(e);
        if (_autoCloseMs > 0) {
            _life.Interval = _autoCloseMs;
            _life.Tick += delegate { Close(); };
            _life.Start();
        }
    }

    protected override void OnMouseDown(MouseEventArgs e) {
        base.OnMouseDown(e);
        Close();
    }

    protected override void OnPaint(PaintEventArgs e) {
        Graphics g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

        using (SolidBrush bg = new SolidBrush(Color.FromArgb(242, 24, 26, 33)))
            g.FillRectangle(bg, ClientRectangle);
        using (Pen edge = new Pen(Color.FromArgb(255, 56, 189, 248), 1.4f))
            g.DrawRectangle(edge, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);

        int pad = 12;
        int y = pad - 2;
        if (!string.IsNullOrEmpty(_original)) {
            using (Font small = new Font("Segoe UI", 8.25f))
            using (SolidBrush dim = new SolidBrush(Color.FromArgb(150, 166, 176)))
            using (StringFormat sf = new StringFormat()) {
                sf.Trimming = StringTrimming.EllipsisCharacter;
                sf.FormatFlags = StringFormatFlags.NoWrap;
                g.DrawString(_original, small, dim, new RectangleF(pad, y, ClientSize.Width - 2 * pad, 16), sf);
            }
            y += 20;
        }
        using (Font big = new Font("Segoe UI Semibold", 10.5f))
        using (SolidBrush fg = new SolidBrush(Color.FromArgb(240, 245, 250))) {
            g.DrawString(_translated, big, fg, new RectangleF(pad, y, ClientSize.Width - 2 * pad, ClientSize.Height - y - pad));
        }
    }
}

// A small, ACTIVATING ask box - "tell JARVIS what to do with this".
//
// The result cards are no-activate popups on purpose (WS_EX_NOACTIVATE, so they
// never steal the keyboard from whatever you are working in), which means a text
// box inside a card can never receive a keystroke. When the user explicitly
// wants to type, we open this instead: an ordinary topmost form that takes focus
// for exactly as long as it is on screen.
//
// Enter = run it, Esc = cancel. Answer holds whatever was typed.
public class JarvisAskBox : Form {
    public string Answer = "";
    private readonly TextBox _box;

    public JarvisAskBox(string prompt, string prefill) {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(18, 20, 26);
        Size = new Size(580, 112);
        KeyPreview = true;

        Label label = new Label();
        label.Text = prompt;
        label.ForeColor = Color.FromArgb(150, 166, 176);
        label.BackColor = Color.Transparent;
        label.Font = new Font("Segoe UI", 8.5f);
        label.Location = new Point(14, 10);
        label.AutoSize = true;
        Controls.Add(label);

        _box = new TextBox();
        _box.Text = prefill ?? "";
        _box.BorderStyle = BorderStyle.FixedSingle;
        _box.BackColor = Color.FromArgb(28, 30, 38);
        _box.ForeColor = Color.FromArgb(240, 245, 250);
        _box.Font = new Font("Segoe UI", 11f);
        _box.Location = new Point(14, 36);
        _box.Size = new Size(552, 28);
        _box.KeyDown += OnBoxKey;
        Controls.Add(_box);

        KeyDown += OnFormKey;
        Shown += delegate { Activate(); _box.Focus(); _box.SelectAll(); };
    }

    private void OnFormKey(object sender, KeyEventArgs e) {
        if (e.KeyCode == Keys.Escape) { Answer = ""; DialogResult = DialogResult.Cancel; Close(); }
    }

    private void OnBoxKey(object sender, KeyEventArgs e) {
        if (e.KeyCode == Keys.Enter) {
            Answer = _box.Text.Trim();
            DialogResult = DialogResult.OK;
            Close();
        } else if (e.KeyCode == Keys.Escape) {
            Answer = "";
            DialogResult = DialogResult.Cancel;
            Close();
        }
    }

    protected override void OnPaint(PaintEventArgs e) {
        using (Pen edge = new Pen(Color.FromArgb(255, 56, 189, 248), 1.4f))
            e.Graphics.DrawRectangle(edge, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
    }
}
