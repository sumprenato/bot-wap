import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

const duration = (value) => {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
let playingAudio = null;
export function AudioPlayer({ message }) {
  const ref = useRef(null),
    [playing, setPlaying] = useState(false),
    [loading, setLoading] = useState(false),
    [position, setPosition] = useState(0),
    [total, setTotal] = useState(0),
    [error, setError] = useState(""),
    [muted, setMuted] = useState(false);
  useEffect(() => {
    const element = ref.current;
    return () => {
      element?.pause();
      if (playingAudio === element) playingAudio = null;
    };
  }, [message.mediaUrl]);
  async function toggle() {
    const element = ref.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    setError("");
    setLoading(true);
    if (playingAudio && playingAudio !== element) playingAudio.pause();
    playingAudio = element;
    try {
      if (element.error) element.load();
      await element.play();
    } catch (failure) {
      if (failure.name !== "AbortError")
        setError(
          "Não foi possível reproduzir este áudio. Tente novamente ou baixe o arquivo.",
        );
    } finally {
      setLoading(false);
    }
  }
  const finiteTotal = Number.isFinite(total) ? total : 0;
  return (
    <div className="audio-player react-audio-player">
      <audio
        ref={ref}
        src={message.mediaUrl}
        muted={muted}
        preload="metadata"
        onLoadedMetadata={(event) => setTotal(event.currentTarget.duration)}
        onDurationChange={(event) => {
          if (Number.isFinite(event.currentTarget.duration))
            setTotal(event.currentTarget.duration);
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          setLoading(false);
        }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onError={() => {
          setPlaying(false);
          setLoading(false);
          setError(
            "Áudio indisponível. Você pode tentar novamente ou baixar o arquivo.",
          );
        }}
      />
      <div className="audio-controls">
        <div className="audio-row">
          <button
            type="button"
            className="audio-play-btn"
            aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
            aria-busy={loading}
            onClick={toggle}
          >
            {playing ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M6 3v18l15-9Z" />
              </svg>
            )}
          </button>
          <span className="audio-time">{duration(position)} / {duration(finiteTotal)}</span>
          <div className="audio-progress-wrap">
            <input
              type="range"
              className="audio-seekbar"
              aria-label="Posição do áudio"
              min="0"
              max={finiteTotal || 1}
              step="0.1"
              value={Math.min(position, finiteTotal || 1)}
              disabled={!finiteTotal}
              onChange={(event) => {
                const value = Number(event.target.value);
                ref.current.currentTime = value;
                setPosition(value);
              }}
            />
          </div>
          <button type="button" className="audio-volume-btn" aria-label={muted ? "Ativar som do áudio" : "Silenciar áudio"} aria-pressed={muted} onClick={() => setMuted(!muted)}><Icon name={muted ? "muted" : "volume"} size={18} /></button>
          <details className="audio-more">
            <summary aria-label="Opções do áudio"><Icon name="more" size={18} /></summary>
            <div className="audio-options">
          <label>
            Velocidade
            <select
              aria-label="Velocidade do áudio"
              defaultValue="1"
              onChange={(event) => {
                ref.current.playbackRate = Number(event.target.value);
              }}
            >
              {[1, 1.5, 2].map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
          <a
            href={message.mediaUrl}
            download={message.fileName || "audio.ogg"}
            className="text-action"
          >
            Baixar áudio
          </a>
            </div>
          </details>
        </div>
        {error && (
          <p className="audio-error" role="status">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
