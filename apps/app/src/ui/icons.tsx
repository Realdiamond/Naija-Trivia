/**
 * Line icons from the mockups (24 px grid, 2 px stroke, round caps), drawn with react-native-svg
 * so they look the same on phones and the web and add no icon font to the download.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from './theme';

export type IconName =
  | 'arrow-right'
  | 'back'
  | 'clock'
  | 'check'
  | 'cross'
  | 'phone'
  | 'mail'
  | 'home'
  | 'play'
  | 'trophy'
  | 'bag'
  | 'coin'
  | 'user'
  | 'bell'
  | 'swords'
  | 'users'
  | 'shuffle'
  | 'timer'
  | 'logout'
  | 'link'
  | 'calendar'
  | 'flame'
  | 'chevron-right'
  | 'shield'
  | 'search';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 24, color = colors.ink, strokeWidth = 2 }: IconProps) {
  const stroke = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {paths(name, stroke)}
    </Svg>
  );
}

type Stroke = {
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  fill: string;
};

function paths(name: IconName, s: Stroke) {
  switch (name) {
    case 'arrow-right':
      return <Path d="M5 12h14M13 6l6 6-6 6" {...s} />;
    case 'back':
      return <Path d="M15 5l-7 7 7 7" {...s} />;
    case 'clock':
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...s} />
          <Path d="M12 7v5l3 2" {...s} />
        </>
      );
    case 'timer':
      return (
        <>
          <Circle cx={12} cy={13} r={8} {...s} />
          <Path d="M12 9v4M10 2h4" {...s} />
        </>
      );
    case 'check':
      return <Path d="M5 12.5l4.5 4.5L19 7" {...s} />;
    case 'cross':
      return <Path d="M6 6l12 12M18 6L6 18" {...s} />;
    case 'phone':
      return (
        <>
          <Rect x={7} y={2.5} width={10} height={19} rx={2.5} {...s} />
          <Path d="M11 18h2" {...s} />
        </>
      );
    case 'mail':
      return (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={2.5} {...s} />
          <Path d="M4 7.5l8 6 8-6" {...s} />
        </>
      );
    case 'home':
      return <Path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" {...s} />;
    case 'play':
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...s} />
          <Path d="M10 8.5v7l5.5-3.5z" {...s} />
        </>
      );
    case 'trophy':
      return (
        <Path
          d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 13v4M8.5 20h7M10 17h4"
          {...s}
        />
      );
    case 'coin':
      return (
        <>
          <Circle cx={12} cy={12} r={8} {...s} />
          <Circle cx={12} cy={12} r={4} {...s} />
        </>
      );
    case 'bag':
      return <Path d="M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8" {...s} />;
    case 'user':
      return (
        <>
          <Circle cx={12} cy={8} r={4} {...s} />
          <Path d="M4.5 20.5c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5" {...s} />
        </>
      );
    case 'shield':
      return <Path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6zM9 12l2 2 4-4" {...s} />;
    case 'search':
      return (
        <>
          <Circle cx={11} cy={11} r={6.5} {...s} />
          <Path d="M16 16l4.5 4.5" {...s} />
        </>
      );
    case 'bell':
      return <Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" {...s} />;
    case 'swords':
      return (
        <Path
          d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"
          {...s}
        />
      );
    case 'users':
      return (
        <>
          <Circle cx={9} cy={8} r={3.5} {...s} />
          <Path
            d="M3 20c.8-3.4 3.1-5 6-5s5.2 1.6 6 5M15.5 4.6a3.5 3.5 0 0 1 0 6.8M18 15.3c1.5.7 2.5 2.2 3 4.7"
            {...s}
          />
        </>
      );
    case 'shuffle':
      return (
        <Path
          d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4"
          {...s}
        />
      );
    case 'link':
      return (
        <Path
          d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
          {...s}
        />
      );
    case 'logout':
      return <Path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h9" {...s} />;
    case 'calendar':
      return (
        <>
          <Rect x={3.5} y={5} width={17} height={15.5} rx={2.5} {...s} />
          <Path d="M3.5 10h17M8 3v4M16 3v4" {...s} />
        </>
      );
    case 'flame':
      return (
        <Path
          d="M12 3c.6 3.4 5 5.3 5 10.3a5 5 0 0 1-10 0c0-2.4 1.1-4 2.4-5 .2 1.7 1 2.8 2 3.3C10.9 8.6 11.1 5.4 12 3z"
          {...s}
        />
      );
    case 'chevron-right':
      return <Path d="M9 5l7 7-7 7" {...s} />;
  }
}
