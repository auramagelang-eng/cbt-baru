import { api } from './api';
import { ViolationLog } from '../types/cbt';

export type ViolationHandler = (type: ViolationLog['type'], message: string, violationsCount: number, autoSubmitted: boolean) => void;

export class AntiCheatEngine {
  private sessionId: string;
  private onViolation: ViolationHandler;
  private isActive = false;
  private blurTimeout: any = null;
  private lastViolationTime = 0;

  private static isTransitioningFullscreen = false;
  public static isModalOpen = false;
  private static _isFocusModeActive = false;

  constructor(sessionId: string, onViolation: ViolationHandler) {
    this.sessionId = sessionId;
    this.onViolation = onViolation;
  }

  public activate(): void {
    if (this.isActive) return;
    this.isActive = true;

    window.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('focus', this.handleFocus);
    window.addEventListener('resize', this.handleResize);

    // Vendor prefixed fullscreen change events
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this.handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', this.handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', this.handleFullscreenChange);

    document.addEventListener('contextmenu', this.handleContextMenu);
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('copy', this.handleCopyCutPaste);
    document.addEventListener('paste', this.handleCopyCutPaste);
    document.addEventListener('cut', this.handleCopyCutPaste);
  }

  public deactivate(): void {
    if (!this.isActive) return;
    this.isActive = false;

    if (this.blurTimeout) {
      clearTimeout(this.blurTimeout);
      this.blurTimeout = null;
    }

    window.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('focus', this.handleFocus);
    window.removeEventListener('resize', this.handleResize);

    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('mozfullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('MSFullscreenChange', this.handleFullscreenChange);

    document.removeEventListener('contextmenu', this.handleContextMenu);
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('copy', this.handleCopyCutPaste);
    document.removeEventListener('paste', this.handleCopyCutPaste);
    document.removeEventListener('cut', this.handleCopyCutPaste);
  }

  /**
   * Sets whether a dialog/modal overlay is currently open to suppress false positive background events.
   */
  public static setModalOpen(open: boolean): void {
    AntiCheatEngine.isModalOpen = open;
  }

  /**
   * Checks if app is running inside an iframe (e.g. AI Studio preview, LMS portal, WebView).
   */
  public static isInsideIframe(): boolean {
    try {
      return typeof window !== 'undefined' && window.self !== window.top;
    } catch {
      return true;
    }
  }

  /**
   * Checks if Fullscreen API is permitted and supported in this document / environment.
   */
  public static isFullscreenSupported(): boolean {
    if (typeof document === 'undefined') return false;
    const doc = document as any;
    const docEl = document.documentElement as any;

    // If running in an iframe without allow="fullscreen", isFullscreenSupported might be false
    if (AntiCheatEngine.isInsideIframe()) {
      try {
        if (doc.fullscreenEnabled === false) return false;
      } catch {
        // ignore
      }
    }

    return !!(
      doc.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      doc.mozFullScreenEnabled ||
      doc.msFullscreenEnabled ||
      docEl?.requestFullscreen ||
      docEl?.webkitRequestFullscreen ||
      docEl?.mozRequestFullScreen ||
      docEl?.msRequestFullscreen
    );
  }

  /**
   * Focus mode getter & setter: authorized equivalent of Fullscreen for environments
   * where native HTML5 requestFullscreen is prohibited (iFrames, strict mobile browsers, Chromebook policies).
   */
  public static get isFocusModeActive(): boolean {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem('cbt_focus_mode') === 'true' || AntiCheatEngine._isFocusModeActive;
    }
    return AntiCheatEngine._isFocusModeActive;
  }

  public static setFocusMode(active: boolean): void {
    AntiCheatEngine._isFocusModeActive = active;
    if (typeof sessionStorage !== 'undefined') {
      if (active) {
        sessionStorage.setItem('cbt_focus_mode', 'true');
      } else {
        sessionStorage.removeItem('cbt_focus_mode');
      }
    }
  }

  /**
   * Checks if device is a mobile or touch device.
   */
  public static isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    return (
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 1024)
    );
  }

  /**
   * Checks if mobile device cannot support HTML5 Fullscreen (e.g. iOS iPhone Safari).
   */
  public static isMobileWithoutFullscreen(): boolean {
    return AntiCheatEngine.isMobileDevice() && !AntiCheatEngine.isFullscreenSupported();
  }

  /**
   * Checks if window appears to be split-screen or tiled (e.g. 2 windows side by side).
   * On desktop/laptop, if innerWidth is less than 85% of screen.width or innerHeight is less than 75% of screen.height,
   * it is an active split-screen or resized window attempt.
   */
  public static isSplitScreenDetected(): boolean {
    if (typeof window === 'undefined' || typeof screen === 'undefined') return false;
    if (AntiCheatEngine.isMobileDevice()) return false; // Touch devices have their own virtual keyboard scaling

    const screenW = window.screen.availWidth || window.screen.width;
    const screenH = window.screen.availHeight || window.screen.height;
    if (!screenW || !screenH) return false;

    const widthRatio = window.innerWidth / screenW;
    const heightRatio = window.innerHeight / screenH;

    // If student shrunk window horizontally to less than 85% of screen width (e.g. split screen 50% left / 50% right)
    // or reduced height to less than 75% of screen height
    return widthRatio < 0.85 || heightRatio < 0.75;
  }

  /**
   * Checks if the window fills the screen (e.g. Windows F11 native browser fullscreen).
   */
  public static isWindowFillingScreen(): boolean {
    if (typeof window === 'undefined' || typeof screen === 'undefined') return false;

    // Firefox on Windows exposes window.fullScreen = true in F11/fullscreen
    if ((window as any).fullScreen === true) {
      return true;
    }

    // Height & Width difference check between screen and viewport
    const heightDiff = Math.abs(window.screen.height - window.innerHeight);
    const widthDiff = Math.abs(window.screen.width - window.innerWidth);

    if (heightDiff <= 20 && widthDiff <= 20) {
      return true;
    }

    return false;
  }

  /**
   * Returns true if either HTML5 fullscreen element is active, Windows F11 mode is active,
   * or running on an authorized mobile/iframe environment.
   * If split screen is detected on desktop, fullscreen is NEVER considered active!
   */
  public static isFullscreenActive(): boolean {
    if (typeof document === 'undefined') return false;

    // 0. STRICT: If desktop student shrunk the window into a split-screen (e.g. side-by-side with AI),
    // immediately treat as NOT fullscreen regardless of any prior focus mode bypass!
    if (AntiCheatEngine.isSplitScreenDetected()) {
      return false;
    }

    // 1. Real HTML5 Fullscreen Element
    const doc = document as any;
    const hasHtml5Element = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );

    if (hasHtml5Element) {
      return true;
    }

    // 2. Check Windows / Linux F11 native browser fullscreen
    if (AntiCheatEngine.isWindowFillingScreen()) {
      return true;
    }

    // 3. Authorized mobile fallback for devices without HTML5 Fullscreen (e.g. iOS Safari)
    if (AntiCheatEngine.isMobileWithoutFullscreen()) {
      return true;
    }

    // 4. Authorized Focus Mode override (ONLY valid if mobile or iframe where native requestFullscreen is blocked,
    // and ONLY when the window is NOT split-screened)
    if (AntiCheatEngine.isFocusModeActive) {
      if (AntiCheatEngine.isMobileDevice() || AntiCheatEngine.isInsideIframe()) {
        return true;
      }
      // On desktop, focus mode is only allowed if window fills almost the whole screen
      return !AntiCheatEngine.isSplitScreenDetected();
    }

    // 5. If running inside an iframe where parent window blocks requestFullscreen
    if (AntiCheatEngine.isInsideIframe() && !AntiCheatEngine.isFullscreenSupported()) {
      return true;
    }

    return false;
  }

  public static async requestFullscreen(): Promise<boolean> {
    if (typeof document === 'undefined') return false;

    // Grace period to prevent spurious blur events during fullscreen transitions
    AntiCheatEngine.isTransitioningFullscreen = true;
    setTimeout(() => {
      AntiCheatEngine.isTransitioningFullscreen = false;
    }, 3500);

    const docEl = document.documentElement as any;
    const body = document.body as any;
    const root = document.getElementById('root') as any;

    const candidateTargets = [docEl, body, root].filter(Boolean);

    for (const target of candidateTargets) {
      try {
        if (target.requestFullscreen) {
          try {
            await target.requestFullscreen({ navigationUI: 'hide' });
            break;
          } catch {
            await target.requestFullscreen();
            break;
          }
        } else if (target.webkitRequestFullscreen) {
          await target.webkitRequestFullscreen();
          break;
        } else if (target.mozRequestFullScreen) {
          await target.mozRequestFullScreen();
          break;
        } else if (target.msRequestFullscreen) {
          await target.msRequestFullscreen();
          break;
        }
      } catch {
        // Try next candidate target
      }
    }

    // Try locking escape key if available
    try {
      if ('keyboard' in navigator && (navigator as any).keyboard?.lock) {
        await (navigator as any).keyboard.lock(['Escape', 'F11']);
      }
    } catch {
      // ignore
    }

    // Give browser brief tick to settle fullscreen state
    await new Promise((resolve) => setTimeout(resolve, 200));

    return AntiCheatEngine.isFullscreenActive();
  }

  public static exitFullscreen(): void {
    if ('keyboard' in navigator && (navigator as any).keyboard?.unlock) {
      try {
        (navigator as any).keyboard.unlock();
      } catch {
        // ignore
      }
    }

    // Also clear focus mode flag on explicit exit
    AntiCheatEngine.setFocusMode(false);

    if (AntiCheatEngine.isFullscreenActive()) {
      const doc = document as any;
      try {
        if (doc.exitFullscreen) {
          doc.exitFullscreen().catch(() => {});
        } else if (doc.webkitExitFullscreen) {
          doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
          doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          doc.msExitFullscreen();
        }
      } catch {
        // Ignore exit errors
      }
    }
  }

  private triggerViolation = async (type: ViolationLog['type'], details: string) => {
    if (!this.isActive) return;
    if (AntiCheatEngine.isModalOpen) return;
    if (AntiCheatEngine.isTransitioningFullscreen) return;

    // Strict client-side cooldown: at least 5 seconds between logged violations
    const now = Date.now();
    if (now - this.lastViolationTime < 5000) {
      return;
    }
    this.lastViolationTime = now;

    // Immediately mark modal as open to suppress duplicate events during state change
    AntiCheatEngine.setModalOpen(true);

    try {
      const res = await api.post('/session/violation', {
        sessionId: this.sessionId,
        type,
        details,
      });

      const { violationsCount, autoSubmitted } = res.data;
      this.onViolation(type, details, violationsCount, autoSubmitted);
    } catch (err) {
      console.error('Gagal mengirim log pelanggaran', err);
      // Reset modal open state on failure so app doesn't stay permanently suppressed
      AntiCheatEngine.setModalOpen(false);
    }
  };

  private handleVisibilityChange = () => {
    if (!this.isActive) return;
    if (AntiCheatEngine.isModalOpen) return;
    if (AntiCheatEngine.isTransitioningFullscreen) return;

    if (document.hidden) {
      this.triggerViolation('TAB_SWITCH', 'Peserta berpindah tab atau meminimalkan browser.');
    }
  };

  private handleBlur = () => {
    if (!this.isActive) return;
    if (AntiCheatEngine.isModalOpen) return;
    if (document.hidden) return; // Managed by visibility change
    if (AntiCheatEngine.isTransitioningFullscreen) return; // Suppress during fullscreen toggle

    // Completely ignore blur on mobile/touch devices (virtual keyboard, URL bar, system notifications)
    if (AntiCheatEngine.isMobileDevice()) {
      return;
    }

    // Windows browsers momentarily fire window.blur when displaying native HUDs or tooltip popups
    if (this.blurTimeout) clearTimeout(this.blurTimeout);
    this.blurTimeout = setTimeout(() => {
      if (!this.isActive) return;
      if (AntiCheatEngine.isModalOpen) return;
      if (document.hidden) return;
      if (document.hasFocus && document.hasFocus()) return; // Focus already returned

      this.triggerViolation('BLUR', 'Fokus layar terlepas dari aplikasi ujian.');
    }, 600);
  };

  private handleFocus = () => {
    if (this.blurTimeout) {
      clearTimeout(this.blurTimeout);
      this.blurTimeout = null;
    }
  };

  private handleResize = () => {
    if (!this.isActive) return;
    if (AntiCheatEngine.isModalOpen) return;
    if (AntiCheatEngine.isTransitioningFullscreen) return;

    // On mobile devices, opening the on-screen virtual keyboard or scrolling resizes the window
    // This MUST NEVER be treated as a cheating violation!
    if (AntiCheatEngine.isMobileDevice()) {
      return;
    }

    // Check Windows F11, split screen (2 windows side by side), or screen exit with debounce
    setTimeout(() => {
      if (!this.isActive) return;
      if (AntiCheatEngine.isModalOpen) return;
      if (AntiCheatEngine.isTransitioningFullscreen) return;

      if (AntiCheatEngine.isSplitScreenDetected()) {
        this.triggerViolation('FULLSCREEN_EXIT', 'Terdeteksi pembagian layar (Split-Screen / 2 Window berdampingan). Wajib menggunakan 1 layar penuh.');
        return;
      }

      if (!AntiCheatEngine.isFullscreenActive()) {
        this.triggerViolation('FULLSCREEN_EXIT', 'Peserta keluar dari mode Layar Penuh (Fullscreen).');
      }
    }, 400);
  };

  private handleFullscreenChange = () => {
    if (!this.isActive) return;
    if (AntiCheatEngine.isModalOpen) return;
    if (AntiCheatEngine.isTransitioningFullscreen) return;

    // Small delay to allow Windows viewport and browser rendering to settle
    setTimeout(() => {
      if (!this.isActive) return;
      if (AntiCheatEngine.isModalOpen) return;
      if (AntiCheatEngine.isTransitioningFullscreen) return;

      if (AntiCheatEngine.isSplitScreenDetected()) {
        this.triggerViolation('FULLSCREEN_EXIT', 'Terdeteksi pembagian layar (Split-Screen / 2 Window berdampingan). Wajib menggunakan 1 layar penuh.');
        return;
      }

      if (!AntiCheatEngine.isFullscreenActive()) {
        this.triggerViolation('FULLSCREEN_EXIT', 'Peserta keluar dari mode Layar Penuh (Fullscreen).');
      }
    }, 450);
  };

  private handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    this.triggerViolation('CONTEXT_MENU', 'Peserta mencoba mengeklik kanan (Context Menu).');
  };

  private handleCopyCutPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    this.triggerViolation('KEY_SHORTCUT', 'Peserta mencoba menyalin/menempel teks (Copy/Cut/Paste).');
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;

    // Prevent accidental Escape key exiting fullscreen
    if (e.key === 'Escape') {
      e.preventDefault();
    }

    // F12 or Ctrl+Shift+I or Ctrl+U
    if (
      e.key === 'F12' ||
      (isCtrlOrCmd && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j')) ||
      (isCtrlOrCmd && (e.key === 'u' || e.key === 'U'))
    ) {
      e.preventDefault();
      this.triggerViolation('KEY_SHORTCUT', 'Peserta mencoba membuka Developer Tools / Source Code.');
      return;
    }

    // Ctrl+C, Ctrl+V, Ctrl+X
    if (isCtrlOrCmd && ['c', 'v', 'x', 'C', 'V', 'X'].includes(e.key)) {
      e.preventDefault();
      this.triggerViolation('KEY_SHORTCUT', `Peserta menekan kombinasi tombol Ctrl+${e.key.toUpperCase()}`);
    }
  };
}
