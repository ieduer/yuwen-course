# frozen_string_literal: true

# Run inside the Discourse container:
#   RAILS_ENV=production bundle exec rails runner scripts/export_discourse_course.rb > discourse-course-export.json

require "json"
require "nokogiri"

FORUM_BASE = "https://forum.rdfzer.com"

CATEGORY_META = {
  17 => { slug: "bixiu-shang", title: "必修上", order: 1 },
  18 => { slug: "bixiu-xia", title: "必修下", order: 2 },
  11 => { slug: "xuanbi-shang", title: "選必上", order: 3 },
  12 => { slug: "xuanbi-zhong", title: "選必中", order: 4 },
  13 => { slug: "xuanbi-xia", title: "選必下", order: 5 }
}.freeze

def absolute_url(value)
  url = value.to_s.strip
  return nil if url.empty?
  return "https:#{url}" if url.start_with?("//")
  return url if url.match?(%r{\Ahttps?://}i)
  return "#{FORUM_BASE}#{url}" if url.start_with?("/")

  url
end

def html_fragment(cooked)
  Nokogiri::HTML5.fragment(cooked.to_s)
rescue StandardError
  Nokogiri::HTML.fragment(cooked.to_s)
end

def compact_text(value)
  value.to_s.gsub(/\s+/, " ").strip
end

def extract_assets(cooked)
  doc = html_fragment(cooked)

  images = doc.css("img").filter_map do |img|
    src = absolute_url(img["src"])
    next unless src

    {
      src: src,
      alt: compact_text(img["alt"]),
      width: img["width"].to_i.positive? ? img["width"].to_i : nil,
      height: img["height"].to_i.positive? ? img["height"].to_i : nil,
      base62: img["data-base62-sha1"],
      classes: img["class"]
    }.compact
  end

  links = doc.css("a[href]").filter_map do |link|
    href = absolute_url(link["href"])
    next unless href

    text = compact_text(link.text)
    {
      href: href,
      text: text.empty? ? href : text,
      title: compact_text(link["title"]),
      classes: link["class"],
      has_image: link.css("img").any?
    }.compact
  end

  attachments = links.select do |link|
    href = link[:href].to_s
    classes = link[:classes].to_s
    href.include?("/uploads/") || href.include?("files.rdfzer.com") || classes.include?("attachment")
  end

  {
    plain_text: compact_text(doc.text),
    images: images.uniq { |item| item[:src] },
    links: links.uniq { |item| item[:href] },
    attachments: attachments.uniq { |item| item[:href] }
  }
end

categories = Category.where(id: CATEGORY_META.keys).index_by(&:id)
topics = Topic
  .where(category_id: CATEGORY_META.keys, deleted_at: nil)
  .where.not(archetype: "private_message")
  .order(:category_id, :created_at, :id)
  .to_a

posts_by_topic = Post
  .where(topic_id: topics.map(&:id), deleted_at: nil, post_type: Post.types[:regular])
  .where(hidden: false)
  .order(:topic_id, :post_number)
  .to_a
  .group_by(&:topic_id)

payload_topics = topics.map do |topic|
  category = categories[topic.category_id]
  meta = CATEGORY_META.fetch(topic.category_id)
  posts = posts_by_topic.fetch(topic.id, []).map do |post|
    assets = extract_assets(post.cooked)
    {
      id: post.id,
      post_number: post.post_number,
      reply_to_post_number: post.reply_to_post_number,
      created_at: post.created_at&.iso8601,
      updated_at: post.updated_at&.iso8601,
      like_count: post.like_count.to_i,
      cooked: post.cooked.to_s,
      plain_text: assets[:plain_text],
      images: assets[:images],
      links: assets[:links],
      attachments: assets[:attachments]
    }
  end

  {
    id: topic.id,
    title: topic.title,
    fancy_title: topic.fancy_title,
    slug: topic.slug,
    category_id: topic.category_id,
    category_slug: meta[:slug],
    category_title: meta[:title],
    category_name: category&.name,
    posts_count: topic.posts_count.to_i,
    visible: topic.visible,
    closed: topic.closed,
    archived: topic.archived,
    created_at: topic.created_at&.iso8601,
    updated_at: topic.updated_at&.iso8601,
    bumped_at: topic.bumped_at&.iso8601,
    forum_url: "#{FORUM_BASE}/t/#{topic.slug}/#{topic.id}",
    posts: posts
  }
end

result = {
  exported_at: Time.now.utc.iso8601,
  forum_base: FORUM_BASE,
  categories: CATEGORY_META.map do |id, meta|
    category = categories[id]
    {
      id: id,
      slug: meta[:slug],
      title: meta[:title],
      name: category&.name,
      topic_count: category&.topic_count.to_i,
      order: meta[:order]
    }
  end,
  topics: payload_topics,
  totals: {
    topics: payload_topics.length,
    posts: payload_topics.sum { |topic| topic[:posts].length },
    images: payload_topics.sum { |topic| topic[:posts].sum { |post| post[:images].length } },
    links: payload_topics.sum { |topic| topic[:posts].sum { |post| post[:links].length } }
  }
}

puts JSON.pretty_generate(result)
