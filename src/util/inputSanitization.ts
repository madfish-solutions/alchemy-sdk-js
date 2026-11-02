import { InputNftTokenType } from '../internal/nft-api.js';
import { NftTokenType } from '../types/nft-types.js';

export function sanitizeTokenType(tokenType?: NftTokenType): InputNftTokenType {
  if (tokenType === NftTokenType.ERC1155 || tokenType === NftTokenType.ERC721) {
    return tokenType;
  }
  return undefined;
}
