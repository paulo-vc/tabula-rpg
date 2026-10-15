import {
  err,
  ok,
  type ImageRepository,
  type ImageWithData,
  type Issue,
  type Result,
  type StoredImage,
} from '@tabula/domain';
import { hashImage } from '@tabula/sync';
import type { ImageProcessor } from '@/lib/image-processing';
import type { Clock, IdGenerator } from './sheets';

const invalid = (message: string): Result<never, Issue> =>
  err({ code: 'imagem-invalida', path: [], message });

/** Galeria de imagens da campanha (do Mestre), para mostrar à mesa na cutscene. */
export class GalleryService {
  constructor(
    private readonly images: ImageRepository,
    private readonly processImage: ImageProcessor,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** Das mais recentes para as mais antigas (só os dados, sem o conteúdo). */
  list(campaignId: string): Promise<StoredImage[]> {
    return this.images.list(campaignId, 'galeria');
  }

  get(campaignId: string, imageId: string): Promise<ImageWithData | undefined> {
    return this.images.get(campaignId, imageId);
  }

  /** Imagem pelo conteúdo (o jogador a guarda ao recebê-la). */
  byHash(campaignId: string, hash: string): Promise<ImageWithData | undefined> {
    return this.images.findByHash(campaignId, hash);
  }

  /** Reduz a imagem escolhida e a guarda na galeria. */
  async add(
    campaignId: string,
    file: Blob,
    input: { title: string; caption: string },
  ): Promise<Result<StoredImage, Issue>> {
    const title = input.title.trim();
    if (!title) return invalid('Dê um nome à imagem.');
    if (title.length > 100) return invalid('O nome pode ter até 100 caracteres.');
    if (input.caption.length > 500) return invalid('A legenda pode ter até 500 caracteres.');
    let processed;
    try {
      processed = await this.processImage(file);
    } catch (error) {
      return invalid(error instanceof Error ? error.message : 'Não foi possível usar a imagem.');
    }
    const meta: StoredImage = {
      id: this.ids.newId(),
      origin: 'galeria',
      hash: hashImage(processed.data),
      mime: processed.mime,
      size: processed.data.byteLength,
      width: processed.width,
      height: processed.height,
      title,
      caption: input.caption.trim(),
      createdAt: this.clock.now(),
    };
    await this.images.save(campaignId, { meta, data: processed.data });
    return ok(meta);
  }

  async delete(campaignId: string, imageId: string): Promise<void> {
    await this.images.delete(campaignId, imageId);
  }
}
