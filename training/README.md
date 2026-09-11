# Waste model training

The linked Kaggle dataset contains two classes: biodegradable and non-biodegradable. It is not an eight-class replacement for the current Gemini classifier, but it can provide a learned material-safety signal.

1. Download and extract the dataset from Kaggle into a local directory, for example `training/dataset/`. Kaggle credentials are required for the download.
2. Install the training dependency:

```powershell
python -m pip install tensorflow
```

3. Train and evaluate on the dataset's separate `TEST/B` and `TEST/N` split:

```powershell
python training/train_waste_model.py training/dataset --output data/models/waste-binary.keras
```

The command writes the model and `data/models/waste-binary.json` with class names, image counts, and held-out metrics. The model is intentionally not wired into `/api/classify` yet: its two labels cannot safely replace the app's eight material categories. To train those categories, add a labelled dataset with classes matching `textile`, `paper`, `e-waste`, `plastic`, `metal`, `glass`, `furniture`, and `organic`, then extend the label map and output head.

The Kaggle dataset is listed as CC BY-SA 4.0. Keep its attribution and license with any redistributed trained artifact.