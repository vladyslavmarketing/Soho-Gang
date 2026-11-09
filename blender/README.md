# Плюшевая змея в Blender

Змея построена с нуля в Blender 5.1 по фото клиента `assets/img/snake-ae.jpg` и поставлена в позу «ae».
Рендер в Cycles на видеокарте (OptiX).

## Запуск

```bash
# собрать сцену и сохранить .blend (по умолчанию C:/Users/vladk/ae-studio/renders/snake.blend)
blender -b --factory-startup --python blender/snake_scene.py

# собрать, отрендерить кадр камеры CamHero (1408×768) и обновить монтажи в blender/renders/
blender -b --factory-startup --python blender/snake_scene.py -- --render

# быстрая проверка: меньше ворса и сэмплов
blender -b --factory-startup --python blender/snake_scene.py -- --render --preview
```

Опции после `--`: `--blend <путь>`, `--density <ворсинок на D²>` (по умолчанию 36000, это около 2,7 млн
ворсинок), `--samples <n>` (160), `--no-hair`, `--cpu`, `--exposure`, `--key`, `--fill`, `--ambient`.
Полная сборка с рендером на RTX 4050 Laptop занимает около минуты.

`.blend` с волосами в репозиторий не кладём: он большой и пересобирается скриптом.

## Что в сцене

Единицы: 1 = D, диаметр тела вместе с мехом. Z вверх, пол под змеёй.

| Объект | Что это |
|---|---|
| `Body` | кожа под мехом: ~19k треугольников, UV `UVMap` (u — доля длины от носа, v — угол от линии брюха), цвет `skin_col`, модификатор Armature |
| `SnakeRig` | скелет: `Head` (жёсткая голова, корень цепочки) + `Spine_01…Spine_56` до кончика хвоста + `Jaw` (дочерняя к голове) |
| `SpinePath` | кривая позвоночника; Spline IK на последней кости. Длина кривой равна длине цепочки, поэтому любая новая кривая той же длины ставит позу без растяжения |
| `EyeL`, `EyeR`, `Tongue` | глаза-бусины и раздвоенный язык, привязаны к кости `Head` |
| `Fur` | волосы (hair curves), только для Cycles: растут на коже в покое и держатся на ней в любой позе через geometry nodes «Deform Curves on Surface»; цвет ворсинки `fur_col`, затемнение корней `root_shade` |
| `CamHero` | камера, совпадающая с фото: 85 мм, наклон 7° вниз, 1 D ≈ 104 px у букв |
| `Sweep`, `Key`, `Beauty`, `Fill`, `Back` | бесшовный пудрово-розовый фон, мягкий ключевой свет слева сверху, большой софтбокс у камеры |

Голова — «яйцо», снятое с силуэта фото (высота ~1.3 D, нос ниже оси, глаз в 0.81 D от носа); линия
позвоночника у головы, шеи, верха «e» и хвоста выровнена по середине тела на фото.

## Как получена поза

Центральная линия змеи размечена по фото (`PATH_PX`, от носа к хвосту) и поднята в 3D лучами из `CamHero`.
Буквы стоят в вертикальной плоскости, там где тело проходит перед собой или за собой, есть смещения по глубине
(`DEPTH`). Хвост уходит назад и за правым краем кадра ложится на пол. Кольца стоят там же, где на фото
(`RINGS_PX` проецируются на линию): 19 колец, у первого чёрная кайма только со стороны хвоста. Цвета
подобраны по средним цветам розовых, кремовых и чёрных пикселей фото.

## Анимация «покой + оглядывание» и экспорт — `blender/snake_anim.py`

```bash
blender -b --factory-startup --python blender/snake_anim.py -- --bake      # ключи на кости -> renders/snake_anim.blend
blender -b --factory-startup --python blender/snake_anim.py -- --clip      # A: Cycles, 180 кадров 1280×720, проходы PNG
blender -b --factory-startup --python blender/snake_anim.py -- --encode    # A: WebM VP9 с альфой + MP4-превью (ffmpeg)
blender -b --factory-startup --python blender/snake_anim.py -- --glb       # B: snake.glb + текстуры + manifest.json
blender -b --factory-startup --python blender/snake_anim.py -- --fur-tile  # B: fur_strands.webp
```

6 с, 30 кадров/с, поза «ae», зациклено: два вдоха (тело раздувается на ~2 %), голова смотрит в одну сторону,
в другую, чуть вверх и возвращается (поворот делят голова и пять шейных позвонков), язык дважды высовывается.
Поза Spline IK запекается в обычные ключи костей, поэтому та же анимация уходит в glTF.

- `export/clipA/` — `snake_idle.webm` (VP9 с альфой, змея с тенью), `snake_idle_preview.mp4` (на розовом фоне).
  Проходы PNG (`rgba_####.png` — змея на прозрачном, `shadow_####.png` — чёрный спрайт тени) лежат локально
  в `C:/Users/vladk/ae-studio/renders/clipA_frames` (около 300 МБ, в git не кладём).
- `export/` — `snake.glb` (кожа со скином, 59 костей, анимация `idle_lookaround`, камера `CamHero`),
  `snake_albedo.webp`, `snake_normal.webp`, `fur_strands.webp`, `manifest.json` (оси, масштабы, мех, файлы).

## Монтажи для одобрения — `blender/renders/`

- `compare_photo_render.webp` — фото | рендер;
- `overlay_50.webp` — фото и рендер наложены 50/50 (проверка позы и толщины);
- `closeup_head.webp`, `closeup_band.webp`, `closeup_tail.webp` — крупные планы: фото слева, рендер справа;
- `render_hero.webp` — сам рендер 1408×768.
