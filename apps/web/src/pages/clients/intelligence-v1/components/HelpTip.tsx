import { Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

interface HelpTipProps {
  /** Plain-English explainer. Keep it lobbyist-friendly — what it is, how it's
   *  calculated, and how to use it. */
  title: ReactNode;
  /** Accessible label for screen readers. */
  label?: string;
}

/**
 * Small "?" help icon with a hover/focus tooltip, used next to intel
 * calculations and tags so non-technical users understand how a number or chip
 * is derived and how to act on it. Keyboard-focusable for accessibility.
 */
export function HelpTip({ title, label = 'How this is calculated' }: HelpTipProps) {
  return (
    <Tooltip title={title} trigger={['hover', 'focus']} styles={{ root: { maxWidth: 340 } }}>
      <QuestionCircleOutlined className="iv1-help-tip" role="img" aria-label={label} tabIndex={0} />
    </Tooltip>
  );
}
