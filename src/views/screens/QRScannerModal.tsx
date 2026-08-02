import { useEffect, useRef, useState } from 'react';

/**
 * Camera-based QR scanner using @zxing/browser (dynamically imported for code splitting).
 *
 * NOTE: This UI is also compatible out-of-the-box with physical USB/Bluetooth barcode
 * scanners running in HID keyboard mode — they type the code into whichever input has
 * focus, so no extra development is needed for that use case.
 */
export function QRScannerModal({
  onScan,
  onClose,
}: {
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stopped = false;
    let stopFn: (() => void) | null = null;

    (async () => {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        if (stopped) return;

        const reader = new BrowserQRCodeReader();
        setReady(true);

        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
          videoRef.current!,
          (result, err) => {
            if (stopped) return;
            if (result) {
              stopped = true;
              controls.stop();
              onScan(result.getText());
            }
          }
        );
        stopFn = () => { stopped = true; controls.stop(); };
      } catch (e: any) {
        if (!stopped) {
          setError(e?.message?.includes('NotAllowed')
            ? 'Accès caméra refusé. Autorisez la caméra dans les paramètres du navigateur.'
            : 'Impossible d\'accéder à la caméra : ' + (e?.message ?? String(e)));
        }
      }
    })();

    return () => {
      stopped = true;
      stopFn?.();
    };
  }, []);

  return (
    <div className="modal-overlay active">
      <div className="scanner-modal">
        <div className="modal-header">
          <h3 className="modal-title">📷 Scanner un ticket</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {!error ? (
          <div className="scanner-video-wrap">
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: '100%', borderRadius: 10, display: 'block', background: '#11141A' }}
            />
            {!ready && (
              <div className="scanner-loading">
                <span style={{ fontSize: 32 }}>📷</span>
                <p>Activation de la caméra…</p>
              </div>
            )}
            <div className="scanner-target-frame" />
          </div>
        ) : (
          <div className="scanner-error">
            <p style={{ fontSize: 14, color: '#FF5C5C' }}>{error}</p>
          </div>
        )}

        <p className="scanner-hint">Pointez la caméra vers le QR code du ticket</p>

        {/* Note: physical USB/Bluetooth barcode scanners in HID keyboard mode work directly — no extra code needed */}
        <p className="scanner-hid-note">
          💡 Scanner physique USB/Bluetooth (mode clavier HID) compatible directement — aucun dev supplémentaire requis.
        </p>

        <div className="modal-actions">
          <button className="btn-cancel" style={{ width: '100%' }} onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
