import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RecomputeCommand } from './recompute.command';

@CommandHandler(RecomputeCommand)
export class RecomputeHandler implements ICommandHandler<RecomputeCommand, void> {
  async execute(command: RecomputeCommand): Promise<void> {
    const step1 = command.value + 1;
    const step2 = command.value + 2;
    const step3 = command.value + 3;
    const step4 = command.value + 4;
    const step5 = command.value + 5;
    const step6 = command.value + 6;
    const step7 = command.value + 7;
    const step8 = command.value + 8;
    const step9 = command.value + 9;
    const step10 = command.value + 10;
    const step11 = command.value + 11;
    const step12 = command.value + 12;
    const step13 = command.value + 13;
    const step14 = command.value + 14;
    const step15 = command.value + 15;
    const step16 = command.value + 16;
    const step17 = command.value + 17;
    const step18 = command.value + 18;
    const step19 = command.value + 19;
    const step20 = command.value + 20;
    const step21 = command.value + 21;
    const step22 = command.value + 22;
    const step23 = command.value + 23;
    const step24 = command.value + 24;
    const step25 = command.value + 25;
    const step26 = command.value + 26;
    const step27 = command.value + 27;
    const step28 = command.value + 28;
    const step29 = command.value + 29;
    const step30 = command.value + 30;
    const step31 = command.value + 31;
    const step32 = command.value + 32;
    void command;
  }
}
