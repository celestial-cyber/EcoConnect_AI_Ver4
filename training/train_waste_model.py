"""Train a binary biodegradable/non-biodegradable waste classifier.

Expected Kaggle layout:
  DATASET/
    TEST/B/*.jpg
    TEST/N/*.jpg
    TRAIN.1/*, TRAIN.2/*, TRAIN.3/*, TRAIN.4/*

The dataset uses BIODEG and NBIODEG in filenames. Directory names are used
as a fallback so the script also works with the extracted TEST folders.
"""

from __future__ import annotations

import argparse
import json
import os
import random
from pathlib import Path

import tensorflow as tf


IMAGE_SIZE = (224, 224)
AUTOTUNE = tf.data.AUTOTUNE
LABELS = {"BIODEG": 0, "NBIODEG": 1, "B": 0, "N": 1}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


def label_for(path: Path) -> int | None:
    parts = {part.upper() for part in path.parts}
    name = path.name.upper()
    if "NBIODEG" in name or "NBIODEG" in parts:
        return LABELS["NBIODEG"]
    if "BIODEG" in name or "BIODEG" in parts:
        return LABELS["BIODEG"]
    for part in path.parts:
        if part.upper() in LABELS:
            return LABELS[part.upper()]
    return None


def collect(root: Path, test: bool) -> tuple[list[str], list[int]]:
    files: list[str] = []
    labels: list[int] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        relative = path.relative_to(root)
        if test and not any(part.upper() == "TEST" for part in relative.parts):
            continue
        if not test and any(part.upper() == "TEST" for part in relative.parts):
            continue
        label = label_for(relative)
        if label is not None:
            files.append(str(path))
            labels.append(label)
    if not files:
        split = "TEST" if test else "TRAIN.*"
        raise SystemExit(f"No labelled images found for {split} under {root}")
    return files, labels


def make_dataset(paths: list[str], labels: list[int], training: bool, batch_size: int):
    ds = tf.data.Dataset.from_tensor_slices((paths, labels))
    if training:
        ds = ds.shuffle(min(len(paths), 20_000), reshuffle_each_iteration=True)

    def load(path, label):
        image = tf.io.read_file(path)
        image = tf.image.decode_jpeg(image, channels=3, try_recover_truncated=True)
        image = tf.image.resize(image, IMAGE_SIZE)
        image = tf.cast(image, tf.float32)
        return image, tf.cast(label, tf.float32)

    return ds.map(load, num_parallel_calls=AUTOTUNE).batch(batch_size).prefetch(AUTOTUNE)


def split_training(paths: list[str], labels: list[int], fraction: float):
    pairs = list(zip(paths, labels))
    random.Random(42).shuffle(pairs)
    cut = max(1, int(len(pairs) * (1 - fraction)))
    train = pairs[:cut]
    validation = pairs[cut:]
    return (
        [path for path, _ in train], [label for _, label in train],
        [path for path, _ in validation], [label for _, label in validation],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path, help="Extracted Kaggle dataset directory")
    parser.add_argument("--output", type=Path, default=Path("data/models/waste-binary.keras"))
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--validation-split", type=float, default=0.15)
    args = parser.parse_args()

    train_paths, train_labels = collect(args.dataset, test=False)
    test_paths, test_labels = collect(args.dataset, test=True)

    train_paths, train_labels, validation_paths, validation_labels = split_training(
        train_paths, train_labels, args.validation_split
    )
    train_ds = make_dataset(train_paths, train_labels, True, args.batch_size)
    validation_ds = make_dataset(validation_paths, validation_labels, False, args.batch_size)
    test_ds = make_dataset(test_paths, test_labels, False, args.batch_size)

    data_augmentation = tf.keras.Sequential([
        tf.keras.layers.RandomFlip("horizontal"),
        tf.keras.layers.RandomRotation(0.08),
        tf.keras.layers.RandomZoom(0.1),
    ])
    base = tf.keras.applications.MobileNetV2(
        input_shape=(*IMAGE_SIZE, 3), include_top=False, weights="imagenet"
    )
    base.trainable = False
    inputs = tf.keras.Input(shape=(*IMAGE_SIZE, 3))
    x = data_augmentation(inputs)
    x = tf.keras.applications.mobilenet_v2.preprocess_input(x)
    x = base(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.2)(x)
    outputs = tf.keras.layers.Dense(1, activation="sigmoid")(x)
    model = tf.keras.Model(inputs, outputs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="auc")],
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_auc", mode="max", patience=2, restore_best_weights=True),
        tf.keras.callbacks.ModelCheckpoint(args.output, monitor="val_auc", mode="max", save_best_only=True),
    ]
    model.fit(
        train_ds,
        validation_data=validation_ds,
        epochs=args.epochs,
        callbacks=callbacks,
    )
    metrics = model.evaluate(test_ds, return_dict=True)
    metadata = {
        "classes": ["biodegradable", "non-biodegradable"],
        "image_size": list(IMAGE_SIZE),
        "metrics": {key: float(value) for key, value in metrics.items()},
        "train_images": len(train_paths),
        "validation_images": len(validation_paths),
        "test_images": len(test_paths),
        "dataset": "rayhanzamzamy/non-and-biodegradable-waste-dataset",
    }
    args.output.with_suffix(".json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    main()