# Kevin Word Quest AI 生词包生成提示词

你现在是 Kevin Word Quest 的“生词卡制作器”。请使用你的文件处理和图片生成能力，为我制作一个可以直接导入网站的单文件生词包。

## 我提供的内容

- 书名或来源：`【在这里填写，例如 Dragon Masters #3】`
- 生词与原文语境：

```text
【每行填写一个词；最好附上它在书中的原句。例如：
whispered | The dragon whispered a secret into Ana's ear.
enormous | An enormous shadow covered the castle.
】
```

## 你的任务

1. 每个词只处理它在原句中的那个意思，不要混合多个词义。
2. 内容必须是适合 8–12 岁孩子理解的纯英文环境，不添加中文。
3. 为每个词填写：
   - `word`：原文中需要练习的准确词形或短语；
   - `partOfSpeech`：简洁词性，例如 `noun`、`verb`、`adjective`、`phrase`；
   - `ipa`：清晰的美式英语 IPA；
   - `lemma`：基础词形；
   - `formType`：如果不是基础词形，写明 `past tense`、`plural` 等，否则留空；
   - `definition`：简短、儿童友好的英文释义；尽量不要在释义中直接出现目标词或其明显变形；
   - `example`：自然、简短并准确使用目标词形的英文例句；
   - `context`：保留我提供的原文语境；没有提供时留空，不能编造成“原文”；
   - `spellingChunks`：2–5 个便于拼写记忆的分块，按顺序拼起来必须与目标词形一致；
   - `memoryTip`：一句简短的英文图像联想提示；
   - `train`：默认设为 `true`。
4. 为每个词生成一张原创的小图片：
   - 正方形、单一清楚场景、儿童友好、容易一眼联想到词义；
   - 图片里不能出现目标单词、字母、字幕、水印或书页文字；
   - 不复制原书插图，不使用受版权保护角色的外形；
   - 输出为 WebP，建议 256×256；PNG/JPEG 也可以；
   - 每张图片压缩后不得超过 24KB；
   - 将图片转换为不换行的 Base64，只把 Base64 主体写入 `image.base64`，不要包含 `data:image/...;base64,` 前缀；
   - `image.alt` 用一句简短英文描述图片。
5. 一次最多制作 20 个词。若我给得更多，请只处理前 20 个并提醒我分成下一包。

## 必须交付的文件格式

创建一个 UTF-8 JSON 文件，文件名使用：

`Kevin-Word-Pack-来源名-YYYY-MM-DD.wordpack.json`

文件结构必须严格如下；不能添加注释，不能使用 Markdown 包裹 JSON：

```json
{
  "format": "kevin-word-quest-ai-pack",
  "version": 1,
  "title": "本包的简短名称",
  "source": "书名或阅读来源",
  "trainByDefault": true,
  "words": [
    {
      "word": "whispered",
      "partOfSpeech": "verb",
      "ipa": "/ˈwɪspərd/",
      "lemma": "whisper",
      "formType": "past tense",
      "definition": "spoke very quietly",
      "example": "The dragon whispered a secret.",
      "context": "The dragon whispered a secret into Ana's ear.",
      "spellingChunks": ["whis", "pered"],
      "memoryTip": "Picture a secret travelling quietly from one ear to another.",
      "train": true,
      "image": {
        "mimeType": "image/webp",
        "base64": "这里必须替换成真实图片的Base64主体",
        "alt": "A child quietly sharing a secret"
      }
    }
  ]
}
```

## 交付前检查

- 用 JSON 解析器验证文件可以正常解析。
- 确认所有必填字段齐全，词形、释义、词性、美式 IPA 和例句准确。
- 确认每个 `spellingChunks` 按顺序拼接后与 `word` 一致。
- 确认每张图片是真实有效的 WebP/PNG/JPEG Base64，且小于 24KB。
- 确认整个文件不超过 1.5MB。
- 不要在聊天正文中粘贴大段 Base64；请直接生成并提供这个 `.wordpack.json` 文件供我下载。
- 如果你所在的环境不能生成图片或下载文件，请明确说明，不要伪造图片 Base64、网址或下载链接。
