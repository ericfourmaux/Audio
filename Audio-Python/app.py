# -*- coding: utf-8 -*-
"""
Audio Re‑Orchestrator (Python, Tkinter)

Application autonome (UI Tkinter) pour:
- Importer un fichier audio (.mp3, .ogg, .flac, .wav)
- Lecture / Pause
- Visualisation de la forme d’onde (mise à l’échelle sur la largeur)
- Curseur de lecture animé
- Deux curseurs de sélection (début / fin) avec mise en évidence (style Audacity)
- Isolation de la sélection vers une nouvelle piste
- Pistes avec contrôle Mute et Volume
- Création de pistes par instrument via séparation de sources (Spleeter 4 stems, si installé)
- Export individuel des pistes en .mp3 / .wav / .flac / .ogg

Dépendances recommandées:
- numpy, matplotlib, sounddevice, soundfile, pydub (ffmpeg nécessaire pour mp3/ogg/flac), spleeter (optionnel)

Références:
- Spleeter (Deezer) — séparation de sources (2/4/5 stems): https://github.com/deezer/spleeter ; https://pypi.org/project/spleeter/ 
- FFmpeg requis par pydub pour encode/décode mp3/ogg/flac: https://github.com/jiaaro/pydub ; https://ffmpeg.org/
"""

import os
import sys
import threading
import tempfile
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

# --- Imports tiers, avec garde-fous ---
missing = []
try:
    import numpy as np
except Exception:
    missing.append('numpy')
    np = None

try:
    import sounddevice as sd
except Exception:
    missing.append('sounddevice')
    sd = None

try:
    import soundfile as sf
except Exception:
    missing.append('soundfile')
    sf = None

try:
    from pydub import AudioSegment
except Exception:
    AudioSegment = None

try:
    import matplotlib
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
except Exception:
    plt = None
    FigureCanvasTkAgg = None
    missing.append('matplotlib')

try:
    import subprocess
except Exception:
    subprocess = None

# --- Tkinter UI ---
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

# --- Utilitaires ---

def has_numpy():
    return np is not None

def has_playback():
    return sd is not None and np is not None

def has_soundfile():
    return sf is not None

def has_pydub():
    return AudioSegment is not None

# --- Modèle de piste ---
@dataclass
class AudioTrack:
    name: str
    data: np.ndarray  # shape: (samples, channels)
    sample_rate: int
    mute: bool = False
    volume: float = 1.0
    color: str = field(default_factory=lambda: '#77e3ff')

    def duration(self) -> float:
        return self.data.shape[0] / float(self.sample_rate)

    def export(self, path: str):
        ext = os.path.splitext(path)[1].lower()
        if ext in ['.wav', '.flac', '.ogg']:
            if not has_soundfile():
                raise RuntimeError('Export require soundfile (libsndfile) pour WAV/FLAC/OGG')
            sf.write(path, self.data, self.sample_rate)
        elif ext in ['.mp3']:
            if not has_pydub():
                raise RuntimeError('Export MP3 requiert pydub + ffmpeg installés')
            seg = AudioSegment(
                (self.data * 32767).astype(np.int16).tobytes(),
                frame_rate=self.sample_rate,
                sample_width=2,
                channels=self.data.shape[1] if self.data.ndim > 1 else 1
            )
            seg.export(path, format='mp3')
        else:
            raise RuntimeError(f'Format non supporté: {ext}')

# --- Projet audio ---
class AudioProject:
    def __init__(self):
        self.tracks: List[AudioTrack] = []
        self.lock = threading.Lock()

    def add_track(self, track: AudioTrack):
        with self.lock:
            self.tracks.append(track)

    def remove_track(self, idx: int):
        with self.lock:
            if 0 <= idx < len(self.tracks):
                self.tracks.pop(idx)

    def max_duration(self) -> float:
        with self.lock:
            if not self.tracks:
                return 0.0
            return max(t.duration() for t in self.tracks)

    def sample_rate(self) -> int:
        with self.lock:
            for t in self.tracks:
                return t.sample_rate
        return 44100

    def mix_block(self, start: int, frames: int) -> np.ndarray:
        with self.lock:
            if not self.tracks:
                return np.zeros((frames, 1), dtype=np.float32)
            max_ch = max(t.data.shape[1] if t.data.ndim > 1 else 1 for t in self.tracks)
            mix = np.zeros((frames, max_ch), dtype=np.float32)
            for t in self.tracks:
                if t.mute:
                    continue
                vol = float(t.volume)
                data = t.data
                ch = data.shape[1] if data.ndim > 1 else 1
                end = min(start + frames, data.shape[0])
                block = data[start:end]
                if block.shape[0] < frames:
                    pad = np.zeros((frames - block.shape[0], ch), dtype=block.dtype)
                    block = np.concatenate([block, pad], axis=0)
                if ch < max_ch:
                    block = np.pad(block, ((0, 0), (0, max_ch - ch)))
                mix += (block.astype(np.float32) * vol)
            np.clip(mix, -1.0, 1.0, out=mix)
            return mix

# --- Chargement audio ---

def load_audio_any(path: str) -> Tuple[np.ndarray, int]:
    ext = os.path.splitext(path)[1].lower()
    if has_soundfile():
        try:
            data, sr = sf.read(path, always_2d=True)
            data = data.astype(np.float32)
            if data.dtype.kind in ['i', 'u']:
                data = data / 32768.0
            return data, sr
        except Exception:
            if AudioSegment is None:
                raise
    if has_pydub():
        seg = AudioSegment.from_file(path)
        sr = seg.frame_rate
        ch = seg.channels
        samples = np.array(seg.get_array_of_samples(), dtype=np.int16)
        if ch > 1:
            samples = samples.reshape((-1, ch))
        else:
            samples = samples.reshape((-1, 1))
        data = (samples.astype(np.float32) / 32768.0)
        return data, sr
    raise RuntimeError('Aucun backend disponible pour lire ce format. Installez soundfile ou pydub+ffmpeg.')

# --- Spleeter ---

def run_spleeter_separation(input_wav: str, outdir: str, stems: int = 4) -> dict:
    if subprocess is None:
        raise RuntimeError('subprocess indisponible; impossible d’appeler Spleeter')
    if stems not in [2, 4, 5]:
        stems = 4
    cmd = [sys.executable, '-m', 'spleeter', 'separate', '-p', f'spleeter:{stems}stems', '-o', outdir, input_wav]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f'Spleeter erreur: {proc.stderr[:300]}')
    except FileNotFoundError:
        cmd = ['spleeter', 'separate', '-p', f'spleeter:{stems}stems', '-o', outdir, input_wav]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f'Spleeter non trouvé ou erreur: {proc.stderr[:300]}')
    base = os.path.splitext(os.path.basename(input_wav))[0]
    track_dir = os.path.join(outdir, base)
    result = {}
    names = ['vocals', 'drums', 'bass'] + (['piano'] if stems == 5 else []) + ['other']
    for n in names:
        p = os.path.join(track_dir, f'{n}.wav')
        if os.path.isfile(p):
            result[n] = p
    return result

# --- Application Tkinter ---
class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title('Audio Re‑Orchestrator (Python/Tkinter)')
        self.project = AudioProject()
        self.playing = False
        self.stream: Optional[sd.OutputStream] = None
        self.position = 0
        self.blocksize = 1024
        self.update_interval_ms = 30
        self.selection_start = 0.0
        self.selection_end = 0.0
        self._build_ui()
        if missing:
            messagebox.showwarning('Dépendances manquantes', 'Modules manquants: ' + ', '.join(missing))

    def _build_ui(self):
        self.root.geometry('1100x700')
        self.root.rowconfigure(0, weight=1)
        self.root.columnconfigure(0, weight=3)
        self.root.columnconfigure(1, weight=1)
        frm_wave = ttk.Frame(self.root)
        frm_wave.grid(row=0, column=0, sticky='nsew')
        frm_wave.rowconfigure(1, weight=1)
        frm_wave.columnconfigure(0, weight=1)
        frm_ctrl = ttk.Frame(frm_wave)
        frm_ctrl.grid(row=0, column=0, sticky='ew', padx=10, pady=10)
        ttk.Button(frm_ctrl, text='Importer audio', command=self.on_import).pack(side='left')
        ttk.Button(frm_ctrl, text='▶️ Play', command=self.on_play).pack(side='left', padx=5)
        ttk.Button(frm_ctrl, text='⏸ Pause', command=self.on_pause).pack(side='left', padx=5)
        ttk.Button(frm_ctrl, text='Isoler sélection ➜ nouvelle piste', command=self.on_isolate_selection).pack(side='left', padx=20)
        ttk.Button(frm_ctrl, text='Séparer en stems (Spleeter)', command=self.on_separate_stems).pack(side='left', padx=5)
        ttk.Button(frm_ctrl, text='Exporter piste…', command=self.on_export_selected_track).pack(side='left', padx=20)
        if plt is not None:
            matplotlib.use('TkAgg')
            self.fig, self.ax = plt.subplots(figsize=(8, 3), dpi=100)
            self.ax.set_title('Forme d’onde')
            self.ax.set_xlabel('Temps (s)')
            self.ax.set_ylabel('Amplitude')
            self.canvas = FigureCanvasTkAgg(self.fig, master=frm_wave)
            self.canvas.get_tk_widget().grid(row=1, column=0, sticky='nsew')
        else:
            self.canvas = None
            self.ax = None
        self.position_var = tk.DoubleVar(value=0.0)
        self.scale_pos = ttk.Scale(frm_wave, from_=0.0, to=1.0, orient='horizontal', variable=self.position_var, command=self.on_seek_percent)
        self.scale_pos.grid(row=2, column=0, sticky='ew', padx=10, pady=5)
        frm_sel = ttk.Frame(frm_wave)
        frm_sel.grid(row=3, column=0, sticky='ew', padx=10, pady=5)
        ttk.Label(frm_sel, text='Début sélection (s)').pack(side='left')
        self.sel_start_var = tk.DoubleVar(value=0.0)
        self.sel_start_scale = ttk.Scale(frm_sel, from_=0.0, to=0.0, orient='horizontal', variable=self.sel_start_var, command=self.on_selection_change)
        self.sel_start_scale.pack(side='left', fill='x', expand=True, padx=5)
        ttk.Label(frm_sel, text='Fin sélection (s)').pack(side='left')
        self.sel_end_var = tk.DoubleVar(value=0.0)
        self.sel_end_scale = ttk.Scale(frm_sel, from_=0.0, to=0.0, orient='horizontal', variable=self.sel_end_var, command=self.on_selection_change)
        self.sel_end_scale.pack(side='left', fill='x', expand=True, padx=5)
        frm_tracks = ttk.Frame(self.root)
        frm_tracks.grid(row=0, column=1, sticky='nsew')
        frm_tracks.columnconfigure(0, weight=1)
        ttk.Label(frm_tracks, text='Pistes').grid(row=0, column=0, sticky='ew', padx=8, pady=8)
        self.tracks_container = ttk.Frame(frm_tracks)
        self.tracks_container.grid(row=1, column=0, sticky='nsew')
        frm_tracks.rowconfigure(1, weight=1)
        self._refresh_tracks_ui()
        self.root.after(self.update_interval_ms, self._update_playhead)

    def _refresh_tracks_ui(self):
        for w in self.tracks_container.winfo_children():
            w.destroy()
        for idx, t in enumerate(self.project.tracks):
            frm = ttk.Frame(self.tracks_container, relief='groove', padding=6)
            frm.grid(row=idx, column=0, sticky='ew', padx=8, pady=4)
            ttk.Label(frm, text=f'{idx+1}. {t.name}').grid(row=0, column=0, sticky='w')
            mute_var = tk.BooleanVar(value=t.mute)
            def on_mute(_v=mute_var, track=t):
                track.mute = _v.get()
            ttk.Checkbutton(frm, text='Mute', variable=mute_var, command=on_mute).grid(row=0, column=1, padx=8)
            vol_var = tk.DoubleVar(value=t.volume)
            def on_vol(_v=vol_var, track=t):
                track.volume = float(_v.get())
            ttk.Scale(frm, from_=0.0, to=1.5, orient='horizontal', variable=vol_var, command=lambda e: on_vol()).grid(row=0, column=2, sticky='ew', padx=8)
            frm.columnconfigure(2, weight=1)
            ttk.Button(frm, text='Exporter…', command=lambda i=idx: self.on_export_track(i)).grid(row=0, column=3, padx=8)

    def _plot_waveform(self):
        if self.canvas is None or self.ax is None:
            return
        self.ax.clear()
        self.ax.set_title('Forme d’onde')
        sr = self.project.sample_rate()
        if self.project.tracks:
            data = self.project.tracks[0].data
            ch0 = data[:, 0] if data.ndim > 1 else data[:, 0]
            samples = ch0.shape[0]
            target = 50000
            step = max(1, samples // target)
            ds = ch0[::step]
            t = np.linspace(0, samples / sr, ds.shape[0])
            self.ax.plot(t, ds, color='#77e3ff', linewidth=0.8)
            if self.selection_end > self.selection_start:
                self.ax.axvspan(self.selection_start, self.selection_end, color='#ff9c6a', alpha=0.25)
            pos_s = self.position / float(sr)
            self.ax.axvline(pos_s, color='#ffdb58', linewidth=1.0)
            self.ax.set_xlim(0, samples / sr)
            self.ax.set_ylim(-1.05, 1.05)
        self.canvas.draw_idle()

    def on_import(self):
        path = filedialog.askopenfilename(title='Choisir un fichier audio', filetypes=[('Audio', '*.wav;*.mp3;*.flac;*.ogg'), ('Tous', '*.*')])
        if not path:
            return
        try:
            data, sr = load_audio_any(path)
        except Exception as e:
            messagebox.showerror('Import échoué', str(e))
            return
        if data.dtype != np.float32:
            data = data.astype(np.float32)
        track = AudioTrack(name=os.path.basename(path), data=data, sample_rate=sr, color='#77e3ff')
        self.project.tracks = [track]
        self.position = 0
        self._refresh_tracks_ui()
        dur = track.duration()
        self.sel_start_scale.config(to=dur)
        self.sel_end_scale.config(to=dur)
        self.selection_start = 0.0
        self.selection_end = min(dur, 5.0)
        self.sel_start_var.set(self.selection_start)
        self.sel_end_var.set(self.selection_end)
        self.scale_pos.config(to=dur)
        self.position_var.set(0.0)
        self._plot_waveform()

    def on_play(self):
        if not has_playback():
            messagebox.showerror('Lecture indisponible', 'Installez sounddevice et numpy pour la lecture audio.')
            return
        if not self.project.tracks or self.playing:
            return
        self.playing = True
        sr = self.project.sample_rate()
        def callback(outdata, frames, time_info, status):
            block = self.project.mix_block(self.position, frames)
            outdata[:] = block
            self.position += frames
            max_samples = int(self.project.max_duration() * sr)
            if self.position >= max_samples:
                self.position = max_samples
                self.playing = False
                raise sd.CallbackStop()
        self.stream = sd.OutputStream(samplerate=sr, channels=max(1, self.project.tracks[0].data.shape[1]), dtype='float32', blocksize=self.blocksize, callback=callback)
        try:
            self.stream.start()
        except Exception as e:
            messagebox.showerror('Erreur lecture', str(e))
            self.playing = False
            self.stream = None

    def on_pause(self):
        self.playing = False
        if self.stream is not None:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
        self.stream = None

    def on_seek_percent(self, _evt=None):
        pos_s = float(self.position_var.get())
        sr = self.project.sample_rate()
        self.position = int(pos_s * sr)
        self._plot_waveform()

    def on_selection_change(self, _evt=None):
        self.selection_start = float(self.sel_start_var.get())
        self.selection_end = float(self.sel_end_var.get())
        if self.selection_end < self.selection_start:
            self.selection_end = self.selection_start
            self.sel_end_var.set(self.selection_end)
        self._plot_waveform()

    def on_isolate_selection(self):
        if not self.project.tracks:
            return
        t = self.project.tracks[0]
        sr = t.sample_rate
        start = int(self.selection_start * sr)
        end = int(self.selection_end * sr)
        if end <= start:
            messagebox.showwarning('Sélection vide', 'Définissez une plage valide (fin > début)')
            return
        seg = t.data[start:end]
        new_track = AudioTrack(name=f'Sélection {self.selection_start:.2f}-{self.selection_end:.2f}s', data=seg, sample_rate=sr, color='#7cffc2')
        self.project.add_track(new_track)
        self._refresh_tracks_ui()

    def on_separate_stems(self):
        if not self.project.tracks:
            return
        if not has_soundfile():
            messagebox.showerror('Séparation indisponible', 'Installez soundfile (libsndfile) pour créer le WAV intermédiaire.')
            return
        tmpdir = tempfile.mkdtemp(prefix='spleeter_')
        tmpwav = os.path.join(tmpdir, 'input.wav')
        main = self.project.tracks[0]
        try:
            sf.write(tmpwav, main.data, main.sample_rate)
        except Exception as e:
            messagebox.showerror('Erreur écriture WAV', str(e))
            return
        try:
            stems = run_spleeter_separation(tmpwav, tmpdir, stems=4)
        except Exception as e:
            messagebox.showerror('Spleeter', str(e))
            return
        added = 0
        for name, path in stems.items():
            try:
                data, sr = load_audio_any(path)
            except Exception:
                continue
            tr = AudioTrack(name=f'Stem: {name}', data=data.astype(np.float32), sample_rate=sr, color={'vocals': '#ff6a6a', 'drums': '#ffd06a', 'bass': '#6aff77'}.get(name, '#77aaff'))
            self.project.add_track(tr)
            added += 1
        if added == 0:
            messagebox.showwarning('Spleeter', 'Aucune piste chargée. Vérifiez l’installation de Spleeter et ffmpeg.')
        else:
            self._refresh_tracks_ui()
            messagebox.showinfo('Spleeter', f'{added} pistes ajoutées (stems).')

    def on_export_track(self, idx: int):
        if not (0 <= idx < len(self.project.tracks)):
            return
        t = self.project.tracks[idx]
        path = filedialog.asksaveasfilename(title='Exporter la piste', defaultextension='.wav', filetypes=[('WAV', '*.wav'), ('FLAC', '*.flac'), ('OGG', '*.ogg'), ('MP3', '*.mp3')], initialfile=f'{t.name}.wav')
        if not path:
            return
        try:
            t.export(path)
            messagebox.showinfo('Export', f'Piste exportée: {path}')
        except Exception as e:
            messagebox.showerror('Export', str(e))

    def on_export_selected_track(self):
        if not self.project.tracks:
            return
        self.on_export_track(0)

    def _update_playhead(self):
        if self.project.tracks:
            sr = self.project.sample_rate()
            pos_s = self.position / float(sr)
            dur = self.project.tracks[0].duration()
            self.scale_pos.config(to=dur)
            self.position_var.set(min(pos_s, dur))
        self._plot_waveform()
        self.root.after(self.update_interval_ms, self._update_playhead)


def main():
    root = tk.Tk()
    style = ttk.Style(root)
    try:
        style.theme_use('clam')
    except Exception:
        pass
    app = App(root)
    root.mainloop()

if __name__ == '__main__':
    main()
