import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CodeOutlined,
  EditOutlined,
  FileTextOutlined,
  LineChartOutlined,
  RocketOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Card, Empty, Input, Skeleton, Tag, Typography } from 'antd';
import { useApi } from '../../lib/use-api.js';
import './skills.css';

const { Title, Paragraph, Text } = Typography;

interface SkillSummary {
  name: string;
  title: string;
  category:
    | 'lobbying'
    | 'productivity'
    | 'research'
    | 'writing'
    | 'developer'
    | 'analysis';
  summary: string;
  recommendedTools: string[];
}

const ICONS: Record<SkillSummary['category'], React.ReactNode> = {
  lobbying: <RocketOutlined style={{ color: '#1677ff' }} />,
  productivity: <ThunderboltOutlined style={{ color: '#52c41a' }} />,
  research: <FileTextOutlined style={{ color: '#722ed1' }} />,
  writing: <EditOutlined style={{ color: '#fa8c16' }} />,
  developer: <CodeOutlined style={{ color: '#13c2c2' }} />,
  analysis: <LineChartOutlined style={{ color: '#eb2f96' }} />,
};

const CATEGORY_ORDER: Array<SkillSummary['category']> = [
  'lobbying',
  'productivity',
  'research',
  'writing',
  'analysis',
  'developer',
];

const LABELS: Record<SkillSummary['category'], string> = {
  lobbying: 'Lobbying',
  productivity: 'Productivity',
  research: 'Research',
  writing: 'Writing',
  developer: 'Developer',
  analysis: 'Analysis',
};

/**
 * Browseable skills catalog. Click a card → opens a new Workspace
 * session with the skill name pre-seeded as the first message so
 * Clio loads the skill and asks for the inputs it needs.
 */
export function SkillsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');

  const skills = useQuery<{ items: SkillSummary[] }>({
    queryKey: ['clio', 'skills'],
    queryFn: async () => (await api.get<{ items: SkillSummary[] }>('/api/clio/skills')).data,
  });

  const grouped = useMemo(() => {
    const items = (skills.data?.items ?? []).filter((s) => {
      if (!filter.trim()) return true;
      const q = filter.toLowerCase();
      return (
        s.title.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q)
      );
    });
    const byCat = new Map<SkillSummary['category'], SkillSummary[]>();
    for (const s of items) {
      const list = byCat.get(s.category) ?? [];
      list.push(s);
      byCat.set(s.category, list);
    }
    return byCat;
  }, [skills.data, filter]);

  async function useSkill(skill: SkillSummary) {
    // Create a fresh session, then navigate to it with the skill seed
    // message queued. The chat pane reads ?seed= and submits it as the
    // first turn so Clio loads the skill immediately.
    try {
      const res = await api.post<{ id: string }>('/api/clio/sessions', {
        title: skill.title,
      });
      const sid = res.data.id;
      const seed = `Use the ${skill.name} skill to help me with ${skill.title.toLowerCase()}.`;
      navigate(`/workspace?session=${sid}&seed=${encodeURIComponent(seed)}`);
    } catch {
      // Fallback: navigate to Workspace; user can paste themselves.
      navigate('/workspace');
    }
  }

  return (
    <div className="skills-page">
      <header className="skills-page__header">
        <Title level={3} style={{ margin: 0 }}>
          Skills library
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
          Pre-defined workflows Clio knows how to run end-to-end. Click one to start a session — Clio
          will load the skill and ask for whatever input it needs.
        </Paragraph>
        <Input.Search
          allowClear
          placeholder="Filter skills…"
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 360, marginTop: 12 }}
        />
      </header>

      {skills.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : grouped.size === 0 ? (
        <Empty description="No skills match that filter." />
      ) : (
        CATEGORY_ORDER.filter((c) => grouped.has(c)).map((cat) => (
          <section key={cat} className="skills-section">
            <Text className="skills-section__title">{LABELS[cat]}</Text>
            <div className="skills-grid">
              {(grouped.get(cat) ?? []).map((s) => (
                <Card
                  key={s.name}
                  className="skill-card"
                  size="small"
                  hoverable
                  onClick={() => useSkill(s)}
                >
                  <div className="skill-card__top">
                    <span className="skill-card__icon" aria-hidden>
                      {ICONS[s.category]}
                    </span>
                    <Text strong>{s.title}</Text>
                  </div>
                  <Paragraph
                    type="secondary"
                    className="skill-card__summary"
                    ellipsis={{ rows: 3 }}
                  >
                    {s.summary}
                  </Paragraph>
                  {s.recommendedTools.length > 0 ? (
                    <div className="skill-card__tools">
                      {s.recommendedTools.slice(0, 3).map((t) => (
                        <Tag key={t} className="skill-card__tool">
                          {t}
                        </Tag>
                      ))}
                      {s.recommendedTools.length > 3 ? (
                        <Tag className="skill-card__tool">
                          +{s.recommendedTools.length - 3}
                        </Tag>
                      ) : null}
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
