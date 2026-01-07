# Audio Re‑Orchestrator (Python/Tkinter)

Une application **autonome** en Python/Tkinter qui permet :

- **Importer** un fichier audio (`.mp3`, `.ogg`, `.flac`, `.wav`).
- **Lire / mettre en pause** le morceau.
- **Visualiser** la forme d’onde (courbe sur la largeur totale disponible).
- **Suivre la lecture** avec un **curseur**.
- Définir une **sélection** (début/fin) via deux curseurs et la **mettre en évidence** (style Audacity).
- **Isoler la sélection** sur une **nouvelle piste**.
- Gérer **plusieurs pistes** (pistes mutables, **contrôle du volume** par piste).
- **Créer une piste par instrument** via **séparation de sources** (Spleeter 4 stems si installé).
- **Exporter** chaque piste individuellement en `.mp3`/`.wav`/`.flac`/`.ogg`.

## Installation

> **Python 3.9+** recommandé. Installez les dépendances suivantes :

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install numpy matplotlib sounddevice soundfile pydub spleeter
```

### FFmpeg (pour mp3/ogg/flac via pydub)
- Installez **FFmpeg** et assurez-vous que la commande `ffmpeg` est disponible dans votre PATH.
- pydub utilise FFmpeg pour décoder/encoder MP3/OGG/FLAC.

Références : pydub + FFmpeg (https://github.com/jiaaro/pydub ; https://ffmpeg.org/)

### Spleeter (séparation de sources)
- Spleeter (**Deezer**) fournit des modèles pré‑entraînés pour séparer un mix en **2/4/5 stems**.
- Installation : `pip install spleeter`
- Site/Repo : https://github.com/deezer/spleeter ; PyPI : https://pypi.org/project/spleeter/

> **Note** : La séparation de sources est optionnelle. Si Spleeter n’est pas installé, le bouton "Séparer en stems" affichera un message.

## Lancer l’application

```bash
python app.py
```

## Utilisation

1. **Importer** un fichier audio.
2. **Play / Pause** pour contrôler la lecture.
3. Utilisez les **curseurs Début/Fin** pour définir une **sélection**. La zone est **mise en évidence** sur la forme d’onde.
4. Cliquez sur **Isoler sélection ➜ nouvelle piste** pour créer une piste à partir de la sélection.
5. Chaque piste a un **Mute** et un **Volume**. Ajustez le mix en temps réel.
6. **Séparer en stems (Spleeter)** : l’application écrit un WAV temporaire et appelle Spleeter pour produire les pistes `vocals`, `drums`, `bass`, `other` (4 stems). Les pistes sont ajoutées au projet automatiquement. *(Spleeter 2/4/5 stems, performances et documentation : voir la page GitHub et PyPI)*.
7. **Exporter piste…** : exportez la piste sélectionnée en `.wav`, `.flac`, `.ogg` (via `soundfile`) ou `.mp3` (via `pydub` + FFmpeg).

## Limitations connues

- La lecture audio requiert `sounddevice` + `numpy` (PortAudio). Sur certaines plateformes, un périphérique audio peut être nécessaire.
- Le décodage MP3/OGG/FLAC dépend de `pydub` + **FFmpeg** ou `soundfile` (libsndfile) selon la configuration.
- La séparation (Spleeter) télécharge et utilise des modèles IA. La première utilisation peut prendre quelques minutes.

## Idées d’extensions

- **Sauvegarde/chargement de projet** (liste des pistes, leurs volumes/mute, positions).
- **Effets** par piste (EQ, compresseur, réverb) via `librosa`/`scipy`.
- **Bounces** partiels (export de la sélection seulement).
- **Spectrogramme** et analyse avancée.
- Intégration **Demucs** en Python (PyTorch) pour une qualité de séparation différente.

## Crédits & Références

- **Spleeter (Deezer)** — séparation de sources (2/4/5 stems), modèles pré‑entraînés et CLI Python :
  - GitHub : https://github.com/deezer/spleeter
  - PyPI : https://pypi.org/project/spleeter/
- **pydub** — lecture/écriture audio en s’appuyant sur **FFmpeg** :
  - GitHub : https://github.com/jiaaro/pydub
  - FFmpeg : https://ffmpeg.org/

```
MIT License — à adapter selon vos besoins.
```
