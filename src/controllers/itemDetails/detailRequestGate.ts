export type DetailRequestToken = Readonly<{
    generation: number;
    itemId: string;
}>;

export class DetailRequestGate {
    private generation = 0;
    private itemId = '';

    begin(itemId: string): DetailRequestToken {
        this.generation += 1;
        this.itemId = itemId;

        return {
            generation: this.generation,
            itemId
        };
    }

    isCurrent(token: DetailRequestToken): boolean {
        return token.generation === this.generation && token.itemId === this.itemId;
    }

    retire(): void {
        this.generation += 1;
        this.itemId = '';
    }
}

