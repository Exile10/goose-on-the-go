/**
 * A picture loads once. A parent drawing again must not hand the image view a new source, and a
 * picture decoded again at a hair's different size must not resize its frame: either one makes the
 * image view load it again, and together they looped thousands of times until Android refused to draw.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { InkProvider } from '@jarida/ink/native';

import { PondPicture, usePictureRatio } from '../pond-picture';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('@/view-models/use-pond-image', () => ({
  usePondImage: (path: string | null) => ({ uri: path ? `data:image/jpeg;base64,${path}` : null, failed: false }),
}));

const { Image } = jest.requireMock('expo-image') as { Image: () => null };

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<InkProvider scheme="light">{element}</InkProvider>);
  });
  return tree;
}

describe('PondPicture', () => {
  it('keeps one source while its parent draws again with new props', () => {
    const tree = render(<PondPicture path="/api/v1/pic/1" label="A" style={{ width: 10 }} />);
    const first = tree.root.findByType(Image).props.source;
    act(() => {
      tree.update(
        <InkProvider scheme="light">
          <PondPicture path="/api/v1/pic/1" label="A" style={{ width: 10 }} onSize={() => undefined} />
        </InkProvider>,
      );
    });
    expect(tree.root.findByType(Image).props.source).toBe(first);
  });
});

describe('usePictureRatio', () => {
  let ratio = 0;
  let onSize: (size: { width: number; height: number }) => void = () => undefined;
  let renders = 0;
  function Probe({ path }: { path: string }) {
    renders += 1;
    [ratio, onSize] = usePictureRatio(path, 4 / 3);
    return null;
  }

  it('takes a picture shape once and ignores a decode a hair off it', () => {
    act(() => {
      create(<Probe path="/api/v1/pic/ratio" />);
    });
    act(() => onSize({ width: 1200, height: 800 }));
    expect(ratio).toBeCloseTo(1.5);
    const settled = renders;

    act(() => onSize({ width: 1080, height: 721 }));
    expect(ratio).toBeCloseTo(1.5);
    expect(renders).toBe(settled);

    act(() => onSize({ width: 800, height: 800 }));
    expect(ratio).toBeCloseTo(1);
  });
});
