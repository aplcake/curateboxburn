export type Chain = 'ethereum' | 'base' | 'abstract';
export type TokenStandard = 'ERC-721' | 'ERC-1155';

export interface Prize {
  id:         string;     // uuid
  name:       string;
  imageUrl:   string;     // object URL or data URL
  tier:       1 | 2;      // 1 = burn×1 prizes, 2 = burn×2 prizes
  chain:      Chain;
  contract:   string;
  tokenId:    string;
  standard:   TokenStandard;
  assigned:   boolean;    // has been rolled to a winner
  distributed:boolean;    // has been sent on-chain
}

export interface Burner {
  wallet:   string;
  tier:     1 | 2;
  txHash:   string;
  rolled:   boolean;      // has been selected by roulette
}

export interface Result {
  id:      string;
  wallet:  string;
  tier:    1 | 2;
  prize:   Prize;
  rolledAt:string;
  txHash?: string;        // distribution tx hash (once sent)
  sent:    boolean;
}

export interface RevealState {
  prizes:  Prize[];
  burners: Burner[];
  results: Result[];
}
