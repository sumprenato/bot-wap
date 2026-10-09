import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export function VoiceRecorder({ ctx }) {
  const active = useRef(true), recorder = useRef(null), stream = useRef(null), cancelled = useRef(false);
  const [recording, setRecording] = useState(false), [requesting, setRequesting] = useState(false), [seconds, setSeconds] = useState(0);
  const release = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
      ctx.setField('voiceRecording', false);
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  async function toggle() {
    if (recording) { recorder.current.stop(); return; }
    if (requesting) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      ctx.notify("Este navegador não permite gravar áudio aqui. Você pode anexar um arquivo de áudio.");
      return;
    }
    setRequesting(true);
    ctx.setField('voiceRecording', true);
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current) { microphone.getTracks().forEach((track) => track.stop()); return; }
      stream.current = microphone;
      const mimeType = ["audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) { release(); ctx.notify("Este navegador não oferece um formato de gravação compatível. Anexe um arquivo de áudio."); return; }
      const capture = new MediaRecorder(microphone, { mimeType });
      const chunks = [];
      cancelled.current = false;
      recorder.current = capture;
      capture.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      capture.onstop = () => {
        release();
        ctx.setField('voiceRecording', false);
        if (!active.current) return;
        setRecording(false);
        if (cancelled.current || !chunks.length) return;
        const type = capture.mimeType || chunks[0].type || "audio/webm";
        const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        ctx.setFile("fileInput", new File(chunks, `audio-${Date.now()}.${extension}`, { type }));
        ctx.notify("Áudio gravado. Revise antes de enviar.", "success");
      };
      capture.onerror = () => {
        cancelled.current = true;
        ctx.setField('voiceRecording', false);
        release();
        if (capture.state === "recording") capture.stop();
        if (active.current) { setRecording(false); ctx.notify("Não foi possível concluir a gravação. Tente novamente."); }
      };
      capture.start();
      setSeconds(0);
      setRecording(true);
    } catch (error) {
      release();
      if (active.current) ctx.notify(error.name === "NotAllowedError" ? "Permita o acesso ao microfone para gravar uma mensagem." : "Não foi possível acessar o microfone. Tente novamente.");
    } finally {
      if (active.current) setRequesting(false);
      if (recorder.current?.state !== 'recording') ctx.setField('voiceRecording', false);
    }
  }
  return <span className="voice-recorder">
    <button type="button" className={"attach-btn" + (recording ? " is-recording" : "")} aria-label={recording ? "Concluir gravação" : "Gravar áudio"} title={recording ? "Concluir gravação" : "Gravar áudio"} disabled={requesting || (!recording && (!(ctx.data.state.channelStatus || ctx.data.state.status)?.connected || ctx.busy === "sendBtn"))} onClick={toggle}><Icon name={recording ? "stop" : "mic"} /></button>
    {recording && <span className="voice-recording-status" role="status"><span className="recording-dot" />{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}<button type="button" onClick={() => { cancelled.current = true; recorder.current.stop(); }}>Descartar</button></span>}
  </span>;
}
