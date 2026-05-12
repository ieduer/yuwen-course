# yuwen-course

高中語文五冊課文學習站：從 `forum.rdfzer.com` 的 `必修上`、`必修下`、`選必上`、`選必中`、`選必下` 五個板塊抽取全部 topic 與回覆資源，並對接 R2/教材圖片。

## Data Pipeline

論壇後端只讀匯出：

```bash
ssh -i ~/.ssh/ravnix_ed25519 root@172.93.160.202 \
  'docker exec -i --user discourse -w /var/www/discourse app bash -lc "RAILS_ENV=production bundle exec rails runner -"' \
  < scripts/export_discourse_course.rb \
  > .cache/discourse-course-export.json
```

生成站點資料：

```bash
npm run build:data
```

## Local Preview

```bash
npm run serve
```

## Deploy

```bash
wrangler pages deploy site --project-name yuwen-course --branch main
```

Runtime secrets:

- `GITHUB_TOKEN`: create/read GitHub Issues for per-lesson discussion.
- `OPENAI_API_KEY`: enable AI multi-turn dialogue.
- `OPENAI_MODEL`: optional model override.
